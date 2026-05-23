import { Hono } from "hono";
import { getRepo, getTree, getFileContent } from "./github.client.ts";
import { githubClientErrorResponse } from "../../shared/github-error.ts";
import { githubAuthMiddleware } from "./github.middleware.ts";
import type { AppVariables } from "../../shared/hono-context.ts";

export const githubApp = new Hono<{ Variables: AppVariables }>();

githubApp.use("*", githubAuthMiddleware);

githubApp.get("/repos/:owner/:repo/tree", async (c) => {
    const { owner, repo } = c.req.param();
    const ref = c.req.query("ref");
    const auth = { token: c.get("githubToken") };

    try {
        const data = await getTree({ owner, repo, ref }, auth);
        return c.json(data);
    } catch (err) {
        return githubClientErrorResponse(err, "Repository");
    }
});

githubApp.get("/repos/:owner/:repo/file", async (c) => {
    const { owner, repo } = c.req.param();
    const path = c.req.query("path");
    const ref = c.req.query("ref");
    const auth = { token: c.get("githubToken") };

    if (!path) {
        return c.json({ error: "Missing required query parameter: path", status: 400 }, 400);
    }

    try {
        const data = await getFileContent({ owner, repo, path, ref }, auth);
        return c.json(data);
    } catch (err) {
        return githubClientErrorResponse(err, "File");
    }
});

githubApp.get("/repos/:owner/:repo", async (c) => {
    const { owner, repo } = c.req.param();
    const auth = { token: c.get("githubToken") };

    try {
        const data = await getRepo({ owner, repo }, auth);
        return c.json(data);
    } catch (err) {
        return githubClientErrorResponse(err, "Repository");
    }
});
