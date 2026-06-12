import { Hono } from "hono";
import { ollamaHealth } from "../ai/ollama.client.ts";
import { githubAuthMiddleware } from "../../shared/github-auth.middleware.ts";
import { errorResponse } from "../../shared/errors.ts";
import type { AppVariables } from "../../shared/hono-context.ts";
import { validateOwnerRepo } from "../../shared/validate.ts";
import {
    deleteRepositoryIndex,
    getRepositoryIndexStatus,
    indexRepository,
} from "./indexing.service.ts";

export const indexApp = new Hono<{ Variables: AppVariables }>();

indexApp.use("*", githubAuthMiddleware);

indexApp.get("/health", async (c) => {
    const ollama = await ollamaHealth();
    return c.json({ ollama });
});

indexApp.post("/repos/:owner/:repo", async (c) => {
    const { owner, repo } = c.req.param();
    const slugError = validateOwnerRepo(owner, repo);
    if (slugError) return errorResponse(slugError, 400);

    const ref = c.req.query("ref");
    const auth = { token: c.get("githubToken") };

    try {
        const meta = await indexRepository(owner, repo, auth, ref);
        return c.json(meta, 202);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Index failed";
        return errorResponse(message, 500);
    }
});

indexApp.get("/repos/:owner/:repo/status", async (c) => {
    const { owner, repo } = c.req.param();
    const slugError = validateOwnerRepo(owner, repo);
    if (slugError) return errorResponse(slugError, 400);

    const ref = c.req.query("ref");
    const auth = { token: c.get("githubToken") };

    try {
        const meta = await getRepositoryIndexStatus(owner, repo, auth, ref);
        return c.json(meta);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Status failed";
        return errorResponse(message, 500);
    }
});

indexApp.delete("/repos/:owner/:repo", async (c) => {
    const { owner, repo } = c.req.param();
    const slugError = validateOwnerRepo(owner, repo);
    if (slugError) return errorResponse(slugError, 400);

    const ref = c.req.query("ref");
    const auth = { token: c.get("githubToken") };

    try {
        await deleteRepositoryIndex(owner, repo, ref, auth);
        return c.json({ ok: true });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Delete failed";
        return errorResponse(message, 500);
    }
});
