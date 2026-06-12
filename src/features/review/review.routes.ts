import { Hono } from "hono";
import { OllamaError } from "../ai/ollama.client.ts";
import { githubAuthMiddleware } from "../../shared/github-auth.middleware.ts";
import { errorResponse, notFound, unauthorized } from "../../shared/errors.ts";
import type { AppVariables } from "../../shared/hono-context.ts";
import { runPullRequestReview, reviewHealth } from "./review.service.ts";

export const reviewApp = new Hono<{ Variables: AppVariables }>();

reviewApp.use("*", githubAuthMiddleware);

reviewApp.get("/health", async (c) => {
    const health = await reviewHealth();
    return c.json(health);
});

reviewApp.post("/repos/:owner/:repo/pulls/:number", async (c) => {
    const { owner, repo, number } = c.req.param();
    const pullNumber = Number(number);
    if (!Number.isFinite(pullNumber) || pullNumber < 1) {
        return c.json({ error: "Invalid pull request number", status: 400 }, 400);
    }

    const auth = { token: c.get("githubToken") };
    const debug = c.req.query("debug") === "true";

    try {
        const result = await runPullRequestReview({
            owner,
            repo,
            number: pullNumber,
            auth,
            includeDebug: debug,
        });
        return c.json(result);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Review failed";

        if (err instanceof OllamaError) {
            return errorResponse(message, 503);
        }

        const ghStatus =
            err && typeof err === "object" && "status" in err
                ? Number((err as { status: number }).status)
                : undefined;

        if (ghStatus === 401) {
            return unauthorized();
        }
        if (ghStatus === 404) {
            return notFound("Pull request", message);
        }
        if (ghStatus === 409) {
            return c.json({ error: message, status: 409 }, 409);
        }

        console.error("[review]", message);
        return errorResponse(message, 500);
    }
});
