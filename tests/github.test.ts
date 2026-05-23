import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { githubRoutes } from "../src/features/github/github.routes.ts";
import type { RepoInfo, FileTree, FileContent } from "../src/features/github/github.types.ts";
import type { ApiError } from "../src/shared/errors.ts";
import { installGitHubFetchMock } from "./support/github-api-mock.ts";

describe("GitHub routes", () => {
    let server: ReturnType<typeof Bun.serve>;
    let restoreFetch: () => void;

    beforeAll(() => {
        process.env.GITHUB_TOKEN = "test-token";
        restoreFetch = installGitHubFetchMock();
        server = Bun.serve({ port: 0, routes: { ...githubRoutes } });
    });

    afterAll(() => {
        server.stop();
        restoreFetch();
        delete process.env.GITHUB_TOKEN;
    });

    describe("GET /github/repos/:owner/:repo", () => {
        test("returnerer repo metadata", async () => {
            const res = await fetch(`${server.url}/github/repos/octocat/Hello-World`);
            const body = (await res.json()) as RepoInfo;

            expect(res.status).toBe(200);
            expect(body.name).toBe("Hello-World");
            expect(body.fullName).toBe("octocat/Hello-World");
            expect(body.defaultBranch).toBe("main");
            expect(body.private).toBe(false);
        });

        test("returnerer 404 hvis repo ikke eksisterer", async () => {
            const res = await fetch(`${server.url}/github/repos/octocat/not-found`);
            const body = (await res.json()) as ApiError;

            expect(res.status).toBe(404);
            expect(body.error).toBeString();
        });

        test("returnerer 401 hvis GITHUB_TOKEN mangler", async () => {
            delete process.env.GITHUB_TOKEN;

            const res = await fetch(`${server.url}/github/repos/octocat/Hello-World`);
            const body = (await res.json()) as ApiError;

            expect(res.status).toBe(401);
            expect(body.error).toBeString();

            process.env.GITHUB_TOKEN = "test-token";
        });
    });

    describe("GET /github/repos/:owner/:repo/tree", () => {
        test("returnerer rekursivt fil-træ", async () => {
            const res = await fetch(`${server.url}/github/repos/octocat/Hello-World/tree`);
            const body = (await res.json()) as FileTree;

            expect(res.status).toBe(200);
            expect(body.truncated).toBe(false);
            expect(body.files).toBeArray();
            expect(body.files).toHaveLength(3);
        });

        test("fil-træet indeholder korrekte felter", async () => {
            const res = await fetch(`${server.url}/github/repos/octocat/Hello-World/tree`);
            const body = (await res.json()) as FileTree;
            const readme = body.files.find((f) => f.path === "README.md");

            expect(readme).toBeDefined();
            expect(readme?.type).toBe("blob");
            expect(readme?.sha).toBe("def456");
        });
    });

    describe("GET /github/repos/:owner/:repo/file", () => {
        test("returnerer fil-indhold som utf-8", async () => {
            const res = await fetch(
                `${server.url}/github/repos/octocat/Hello-World/file?path=README.md`,
            );
            const body = (await res.json()) as FileContent;

            expect(res.status).toBe(200);
            expect(body.content).toBe("# Hello World\n");
            expect(body.encoding).toBe("utf-8");
            expect(body.path).toBe("README.md");
        });

        test("returnerer 400 hvis path query-param mangler", async () => {
            const res = await fetch(`${server.url}/github/repos/octocat/Hello-World/file`);
            const body = (await res.json()) as ApiError;

            expect(res.status).toBe(400);
            expect(body.error).toBeString();
        });
    });
});
