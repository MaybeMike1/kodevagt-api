import { describe, test, expect, beforeAll, afterAll } from "bun:test";
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
} from "../src/features/github/github.client.ts";
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

    describe("listUserRepos", () => {
        test("mapper GitHub API-svar til RepoList", async () => {
            const result = await listUserRepos({}, testAuth);

            expect(result.repos).toHaveLength(2);
            expect(result.repos[0]?.fullName).toBe("octocat/Hello-World");
            expect(result.repos[0]?.owner).toBe("octocat");
            expect(result.repos[0]?.defaultBranch).toBe("main");
        });
    });

    describe("listPullRequests", () => {
        test("mapper GitHub API-svar til PullRequestList", async () => {
            const result = await listPullRequests(
                { owner: "octocat", repo: "Hello-World" },
                testAuth,
            );

            expect(result.pulls).toHaveLength(2);
            expect(result.pulls[0]?.number).toBe(42);
            expect(result.pulls[0]?.title).toBe("Add feature");
            expect(result.pulls[0]?.htmlUrl).toBe("https://github.com/octocat/Hello-World/pull/42");
            expect(result.pulls[0]?.user.login).toBe("octocat");
            expect(result.pulls[0]?.user.avatarUrl).toBe(
                "https://github.com/images/error/octocat_happy.gif",
            );
            expect(result.pulls[0]?.headRef).toBe("feature-branch");
            expect(result.pulls[0]?.baseRef).toBe("main");
            expect(result.pulls[0]?.draft).toBe(false);
            expect(result.pulls[1]?.state).toBe("closed");
        });
    });

    describe("getPullRequest", () => {
        test("mapper GitHub API-svar til PullRequestDetail", async () => {
            const pr = await getPullRequest(
                { owner: "octocat", repo: "Hello-World", number: 42 },
                testAuth,
            );

            expect(pr.number).toBe(42);
            expect(pr.title).toBe("Add feature");
            expect(pr.body).toContain("Summary");
            expect(pr.additions).toBe(24);
            expect(pr.changedFiles).toBe(2);
            expect(pr.labels[0]?.name).toBe("enhancement");
        });
    });

    describe("listPullRequestFiles", () => {
        test("mapper filer med patch", async () => {
            const result = await listPullRequestFiles(
                { owner: "octocat", repo: "Hello-World", number: 42 },
                testAuth,
            );

            expect(result.files).toHaveLength(2);
            expect(result.files[0]?.status).toBe("added");
            expect(result.files[0]?.patch).toContain("export function feature");
        });
    });

    describe("listPullRequestCommits", () => {
        test("mapper commits til camelCase", async () => {
            const result = await listPullRequestCommits(
                { owner: "octocat", repo: "Hello-World", number: 42 },
                testAuth,
            );

            expect(result.commits).toHaveLength(1);
            expect(result.commits[0]?.sha).toBe("abc123def456");
            expect(result.commits[0]?.author?.login).toBe("octocat");
        });
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

    describe("getContents", () => {
        test("returnerer rod-mappe som ContentItem[]", async () => {
            const contents = await getContents(
                { owner: "octocat", repo: "Hello-World", ref: "main" },
                testAuth,
            );

            expect(Array.isArray(contents)).toBe(true);
            if (!Array.isArray(contents)) return;
            expect(contents).toHaveLength(3);
            expect(contents[0]?.name).toBe("README.md");
            expect(contents[0]?.type).toBe("file");
            expect(contents[1]?.type).toBe("dir");
        });

        test("returnerer enkelt fil med base64-indhold", async () => {
            const file = await getContents(
                { owner: "octocat", repo: "Hello-World", path: "README.md", ref: "main" },
                testAuth,
            );

            expect(Array.isArray(file)).toBe(false);
            if (Array.isArray(file)) return;
            expect(file.name).toBe("README.md");
            expect(file.encoding).toBe("base64");
            expect(file.content).toBe(Buffer.from("# Hello World\n").toString("base64"));
        });
    });

    describe("listBranches", () => {
        test("mapper branches til camelCase", async () => {
            const branches = await listBranches(
                { owner: "octocat", repo: "Hello-World" },
                testAuth,
            );

            expect(branches).toHaveLength(2);
            expect(branches[0]?.name).toBe("main");
            expect(branches[0]?.commit.sha).toBe("abc123");
            expect(branches[0]?.protected).toBe(true);
        });
    });

    describe("listCommits", () => {
        test("returnerer commits og Link-header", async () => {
            const { commits, link } = await listCommits(
                { owner: "octocat", repo: "Hello-World", sha: "main", perPage: 1 },
                testAuth,
            );

            expect(commits).toHaveLength(1);
            expect(link).toContain('rel="last"');
        });
    });
});
