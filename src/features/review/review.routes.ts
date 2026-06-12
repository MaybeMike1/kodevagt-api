import { Hono } from "hono";
import { OllamaError } from "../ai/ollama.client.ts";
import { githubAuthMiddleware } from "../../shared/github-auth.middleware.ts";
import { errorResponse, notFound, unauthorized } from "../../shared/errors.ts";
import type { AppVariables } from "../../shared/hono-context.ts";
import { validateOwnerRepo } from "../../shared/validate.ts";
import { config } from "../../shared/config.ts";
import {
    getReviewJobStatus,
    runSyncReview,
    startReviewJob,
} from "./review-jobs.service.ts";
import { reviewHealth } from "./review.service.ts";

export const reviewApp = new Hono<{ Variables: AppVariables }>();

reviewApp.use("*", githubAuthMiddleware);

reviewApp.get("/health", async (c) => {
    const health = await reviewHealth();
    return c.json(health);
});

reviewApp.get("/jobs/:jobId", (c) => {
    const job = getReviewJobStatus(c.req.param("jobId"));
    if (!job) return notFound("Review job");
    const status = job.status === "completed" ? 200 : job.status === "failed" ? 500 : 202;
    return c.json(job, status);
});

reviewApp.post("/repos/:owner/:repo/pulls/:number", async (c) => {
    const { owner, repo, number } = c.req.param();
    const pullNumber = Number(number);
    if (!Number.isFinite(pullNumber) || pullNumber < 1) {
        return errorResponse("Invalid pull request number", 400);
    }

    const slugError = validateOwnerRepo(owner, repo);
    if (slugError) return errorResponse(slugError, 400);

    const auth = { token: c.get("githubToken") };
    const debug = c.req.query("debug") === "true";
    const force = c.req.query("force") === "true";
    const sync =
        c.req.query("sync") === "true" ||
        (!config.reviewAsyncDefault && c.req.query("async") !== "true");

    try {
        if (sync) {
            const result = await runSyncReview({
                owner,
                repo,
                number: pullNumber,
                auth,
                includeDebug: debug,
                force,
            });
            return c.json(result);
        }

        const started = await startReviewJob({
            owner,
            repo,
            number: pullNumber,
            auth,
            includeDebug: debug,
            force,
        });

        if (started.kind === "cached") {
            return c.json(started.result);
        }

        return c.json(started.job, 202);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Review failed";

        if (err instanceof OllamaError) {
            return errorResponse(message, 503);
        }

        const ghStatus =
            err && typeof err === "object" && "status" in err
                ? Number((err as { status: number }).status)
                : undefined;

        if (ghStatus === 401) return unauthorized();
        if (ghStatus === 404) return notFound("Pull request", message);
        if (ghStatus === 409) return errorResponse(message, 409);

        console.error("[review]", message);
        return errorResponse(message, 500);
    }
});
