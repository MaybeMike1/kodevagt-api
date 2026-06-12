import { Hono, type Context } from "hono";
import {
    listUserRepos,
    listPullRequests,
    getPullRequest,
    listPullRequestFiles,
    listPullRequestCommits,
    getRepo,
    getTree,
    getFileContent,
    getContents,
    listBranches,
    listCommits,
} from "./github.client.ts";
import { githubClientErrorResponse } from "../../shared/github-error.ts";
import { githubAuthMiddleware } from "./github.middleware.ts";
import type { AppVariables } from "../../shared/hono-context.ts";

export const githubApp = new Hono<{ Variables: AppVariables }>();

githubApp.use("*", githubAuthMiddleware);

githubApp.get("/repos", async (c) => {
    const auth = { token: c.get("githubToken") };
    const page = c.req.query("page");
    const perPage = c.req.query("per_page");
    const sort = c.req.query("sort");
    const direction = c.req.query("direction");
    const affiliation = c.req.query("affiliation");

    try {
        const data = await listUserRepos(
            {
                page: page ? Number(page) : undefined,
                perPage: perPage ? Number(perPage) : undefined,
                sort: sort as "created" | "updated" | "pushed" | "full_name" | undefined,
                direction: direction as "asc" | "desc" | undefined,
                affiliation,
            },
            auth,
        );
        return c.json(data);
    } catch (err) {
        return githubClientErrorResponse(err, "Repositories");
    }
});

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

async function handleContents(c: Context<{ Variables: AppVariables }>) {
    const { owner, repo } = c.req.param();
    const ref = c.req.query("ref");
    const path = c.req.param("path") ?? "";
    const auth = { token: c.get("githubToken") };

    try {
        const data = await getContents(
            { owner: owner!, repo: repo!, path: path || undefined, ref },
            auth,
        );
        return c.json(data);
    } catch (err) {
        return githubClientErrorResponse(err, "Contents");
    }
}

githubApp.get("/repos/:owner/:repo/contents", handleContents);
githubApp.get("/repos/:owner/:repo/contents/", handleContents);
githubApp.get("/repos/:owner/:repo/contents/:path{.+}", handleContents);

githubApp.get("/repos/:owner/:repo/branches", async (c) => {
    const { owner, repo } = c.req.param();
    const page = c.req.query("page");
    const perPage = c.req.query("per_page");
    const auth = { token: c.get("githubToken") };

    try {
        const data = await listBranches(
            {
                owner,
                repo,
                page: page ? Number(page) : undefined,
                perPage: perPage ? Number(perPage) : undefined,
            },
            auth,
        );
        return c.json(data);
    } catch (err) {
        return githubClientErrorResponse(err, "Branches");
    }
});

githubApp.get("/repos/:owner/:repo/commits", async (c) => {
    const { owner, repo } = c.req.param();
    const sha = c.req.query("sha");
    const perPage = c.req.query("per_page");
    const page = c.req.query("page");
    const auth = { token: c.get("githubToken") };

    try {
        const { commits, link } = await listCommits(
            {
                owner,
                repo,
                sha,
                perPage: perPage ? Number(perPage) : undefined,
                page: page ? Number(page) : undefined,
            },
            auth,
        );
        if (link) {
            c.header("Link", link);
        }
        return c.json(commits);
    } catch (err) {
        return githubClientErrorResponse(err, "Commits");
    }
});

githubApp.get("/repos/:owner/:repo/pulls/:number", async (c) => {
    const { owner, repo, number: numberParam } = c.req.param();
    const number = Number(numberParam);
    const auth = { token: c.get("githubToken") };

    if (!Number.isFinite(number) || number < 1) {
        return c.json({ error: "Invalid pull request number", status: 400 }, 400);
    }

    try {
        const data = await getPullRequest({ owner, repo, number }, auth);
        return c.json(data);
    } catch (err) {
        return githubClientErrorResponse(err, "Pull request");
    }
});

githubApp.get("/repos/:owner/:repo/pulls/:number/files", async (c) => {
    const { owner, repo, number: numberParam } = c.req.param();
    const number = Number(numberParam);
    const auth = { token: c.get("githubToken") };

    if (!Number.isFinite(number) || number < 1) {
        return c.json({ error: "Invalid pull request number", status: 400 }, 400);
    }

    try {
        const data = await listPullRequestFiles({ owner, repo, number }, auth);
        return c.json(data);
    } catch (err) {
        return githubClientErrorResponse(err, "Pull request files");
    }
});

githubApp.get("/repos/:owner/:repo/pulls/:number/commits", async (c) => {
    const { owner, repo, number: numberParam } = c.req.param();
    const number = Number(numberParam);
    const auth = { token: c.get("githubToken") };

    if (!Number.isFinite(number) || number < 1) {
        return c.json({ error: "Invalid pull request number", status: 400 }, 400);
    }

    try {
        const data = await listPullRequestCommits({ owner, repo, number }, auth);
        return c.json(data);
    } catch (err) {
        return githubClientErrorResponse(err, "Pull request commits");
    }
});

githubApp.get("/repos/:owner/:repo/pulls", async (c) => {
    const { owner, repo } = c.req.param();
    const auth = { token: c.get("githubToken") };
    const state = c.req.query("state");
    const head = c.req.query("head");
    const base = c.req.query("base");
    const sort = c.req.query("sort");
    const direction = c.req.query("direction");
    const page = c.req.query("page");
    const perPage = c.req.query("per_page");

    try {
        const data = await listPullRequests(
            {
                owner,
                repo,
                state: state as "open" | "closed" | "all" | undefined,
                head,
                base,
                sort: sort as "created" | "updated" | "popularity" | "long-running" | undefined,
                direction: direction as "asc" | "desc" | undefined,
                page: page ? Number(page) : undefined,
                perPage: perPage ? Number(perPage) : undefined,
            },
            auth,
        );
        return c.json(data);
    } catch (err) {
        return githubClientErrorResponse(err, "Pull requests");
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
