import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { getRepo, getTree, getFileContent } from "../src/features/github/github.client.ts";
import { installGitHubFetchMock } from "./support/github-api-mock.ts";

const testAuth = { token: "test-token" };

describe("github.client", () => {
    let restoreFetch: () => void;

    beforeAll(() => {
        restoreFetch = installGitHubFetchMock();
    });

    afterAll(() => {
        restoreFetch();
    });

    describe("getRepo", () => {
        test("mapper GitHub API-svar til RepoInfo", async () => {
            const repo = await getRepo({ owner: "octocat", repo: "Hello-World" }, testAuth);

            expect(repo.id).toBe(1296269);
            expect(repo.name).toBe("Hello-World");
            expect(repo.fullName).toBe("octocat/Hello-World");
            expect(repo.defaultBranch).toBe("main");
            expect(repo.private).toBe(false);
            expect(repo.stargazersCount).toBe(2048);
        });

        test("kaster 404 når repo ikke findes", async () => {
            await expect(getRepo({ owner: "octocat", repo: "not-found" }, testAuth)).rejects.toMatchObject({
                status: 404,
            });
        });
    });

    describe("getTree", () => {
        test("returnerer fil-træ og filtrerer ugyldige noder", async () => {
            const tree = await getTree({ owner: "octocat", repo: "Hello-World" }, testAuth);

            expect(tree.sha).toBe("abc123");
            expect(tree.truncated).toBe(false);
            expect(tree.files).toHaveLength(3);
            expect(tree.files.every((f) => f.type === "blob" || f.type === "tree")).toBe(true);
        });

        test("bruger default branch fra getRepo når ref mangler", async () => {
            const tree = await getTree({ owner: "octocat", repo: "Hello-World" }, testAuth);

            expect(tree.files.find((f) => f.path === "README.md")).toEqual({
                path: "README.md",
                type: "blob",
                size: 42,
                sha: "def456",
            });
        });
    });

    describe("getFileContent", () => {
        test("dekoder base64-indhold til utf-8", async () => {
            const file = await getFileContent(
                { owner: "octocat", repo: "Hello-World", path: "README.md" },
                testAuth,
            );

            expect(file.path).toBe("README.md");
            expect(file.content).toBe("# Hello World\n");
            expect(file.encoding).toBe("utf-8");
            expect(file.size).toBe(14);
        });
    });
});
