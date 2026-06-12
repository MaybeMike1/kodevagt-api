import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { app } from "../src/app.ts";
import type {
    RepoInfo,
    RepoList,
    FileTree,
    FileContent,
    PullRequestCommitList,
    PullRequestDetail,
    PullRequestFileList,
    PullRequestList,
    ContentItem,
    ContentFileEntry,
    Branch,
} from "../src/features/github/github.types.ts";
import type { ApiError } from "../src/shared/errors.ts";
import { installGitHubFetchMock } from "./support/github-api-mock.ts";

describe("GitHub routes", () => {
    let restoreFetch: () => void;

    beforeAll(() => {
        process.env.GITHUB_TOKEN = "test-token";
        restoreFetch = installGitHubFetchMock();
    });

    afterAll(() => {
        restoreFetch();
        delete process.env.GITHUB_TOKEN;
    });

    describe("GET /github/repos", () => {
        test("returnerer brugerens repositories", async () => {
            const res = await app.request("/github/repos");
            const body = (await res.json()) as RepoList;

            expect(res.status).toBe(200);
            expect(body.repos).toBeArray();
            expect(body.repos).toHaveLength(2);
            expect(body.repos[0]?.fullName).toBe("octocat/Hello-World");
            expect(body.repos[0]?.owner).toBe("octocat");
            expect(body.repos[1]?.name).toBe("Spoon-Knife");
        });
    });

    describe("GET /github/repos/:owner/:repo/pulls", () => {
        test("returnerer pull requests for et repository", async () => {
            const res = await app.request("/github/repos/octocat/Hello-World/pulls");
            const body = (await res.json()) as PullRequestList;

            expect(res.status).toBe(200);
            expect(body.pulls).toBeArray();
            expect(body.pulls).toHaveLength(2);
            expect(body.pulls[0]?.number).toBe(42);
            expect(body.pulls[0]?.title).toBe("Add feature");
            expect(body.pulls[0]?.headRef).toBe("feature-branch");
            expect(body.pulls[0]?.user.login).toBe("octocat");
        });

        test("accepterer Bearer token i Authorization header", async () => {
            delete process.env.GITHUB_TOKEN;

            const res = await app.request("/github/repos/octocat/Hello-World/pulls", {
                headers: { Authorization: "Bearer test-token" },
            });
            const body = (await res.json()) as PullRequestList;

            expect(res.status).toBe(200);
            expect(body.pulls).toHaveLength(2);

            process.env.GITHUB_TOKEN = "test-token";
        });
    });

    describe("GET /github/repos/:owner/:repo/pulls/:number", () => {
        test("returnerer pull request detaljer", async () => {
            const res = await app.request("/github/repos/octocat/Hello-World/pulls/42");
            const body = (await res.json()) as PullRequestDetail;

            expect(res.status).toBe(200);
            expect(body.number).toBe(42);
            expect(body.title).toBe("Add feature");
            expect(body.body).toContain("Summary");
            expect(body.additions).toBe(24);
            expect(body.changedFiles).toBe(2);
            expect(body.labels[0]?.name).toBe("enhancement");
        });

        test("returnerer 400 for ugyldigt PR-nummer", async () => {
            const res = await app.request("/github/repos/octocat/Hello-World/pulls/abc");
            const body = (await res.json()) as ApiError;

            expect(res.status).toBe(400);
            expect(body.error).toBeString();
        });
    });

    describe("GET /github/repos/:owner/:repo/pulls/:number/files", () => {
        test("returnerer ændrede filer med patch", async () => {
            const res = await app.request("/github/repos/octocat/Hello-World/pulls/42/files");
            const body = (await res.json()) as PullRequestFileList;

            expect(res.status).toBe(200);
            expect(body.files).toHaveLength(2);
            expect(body.files[0]?.filename).toBe("src/feature.ts");
            expect(body.files[0]?.status).toBe("added");
            expect(body.files[0]?.patch).toContain("export function feature");
        });
    });

    describe("GET /github/repos/:owner/:repo/pulls/:number/commits", () => {
        test("returnerer commits for pull request", async () => {
            const res = await app.request("/github/repos/octocat/Hello-World/pulls/42/commits");
            const body = (await res.json()) as PullRequestCommitList;

            expect(res.status).toBe(200);
            expect(body.commits).toHaveLength(1);
            expect(body.commits[0]?.sha).toBe("abc123def456");
            expect(body.commits[0]?.author?.login).toBe("octocat");
        });
    });

    describe("GET /github/repos/:owner/:repo", () => {
        test("returnerer repo metadata", async () => {
            const res = await app.request("/github/repos/octocat/Hello-World");
            const body = (await res.json()) as RepoInfo;

            expect(res.status).toBe(200);
            expect(body.name).toBe("Hello-World");
            expect(body.fullName).toBe("octocat/Hello-World");
            expect(body.defaultBranch).toBe("main");
            expect(body.private).toBe(false);
        });

        test("returnerer 404 hvis repo ikke eksisterer", async () => {
            const res = await app.request("/github/repos/octocat/not-found");
            const body = (await res.json()) as ApiError;

            expect(res.status).toBe(404);
            expect(body.error).toBeString();
        });

        test("returnerer 401 hvis ingen token er tilgængelig", async () => {
            delete process.env.GITHUB_TOKEN;

            const res = await app.request("/github/repos/octocat/Hello-World");
            const body = (await res.json()) as ApiError;

            expect(res.status).toBe(401);
            expect(body.error).toContain("Authorization: Bearer");

            process.env.GITHUB_TOKEN = "test-token";
        });

        test("accepterer Bearer token i Authorization header", async () => {
            delete process.env.GITHUB_TOKEN;

            const res = await app.request("/github/repos/octocat/Hello-World", {
                headers: { Authorization: "Bearer test-token" },
            });
            const body = (await res.json()) as RepoInfo;

            expect(res.status).toBe(200);
            expect(body.name).toBe("Hello-World");

            process.env.GITHUB_TOKEN = "test-token";
        });
    });

    describe("GET /github/repos/:owner/:repo/tree", () => {
        test("returnerer rekursivt fil-træ", async () => {
            const res = await app.request("/github/repos/octocat/Hello-World/tree");
            const body = (await res.json()) as FileTree;

            expect(res.status).toBe(200);
            expect(body.truncated).toBe(false);
            expect(body.files).toBeArray();
            expect(body.files).toHaveLength(3);
        });

        test("fil-træet indeholder korrekte felter", async () => {
            const res = await app.request("/github/repos/octocat/Hello-World/tree");
            const body = (await res.json()) as FileTree;
            const readme = body.files.find((f) => f.path === "README.md");

            expect(readme).toBeDefined();
            expect(readme?.type).toBe("blob");
            expect(readme?.sha).toBe("def456");
        });
    });

    describe("GET /github/repos/:owner/:repo/file", () => {
        test("returnerer fil-indhold som utf-8", async () => {
            const res = await app.request(
                "/github/repos/octocat/Hello-World/file?path=README.md",
            );
            const body = (await res.json()) as FileContent;

            expect(res.status).toBe(200);
            expect(body.content).toBe("# Hello World\n");
            expect(body.encoding).toBe("utf-8");
            expect(body.path).toBe("README.md");
        });

        test("returnerer 400 hvis path query-param mangler", async () => {
            const res = await app.request("/github/repos/octocat/Hello-World/file");
            const body = (await res.json()) as ApiError;

            expect(res.status).toBe(400);
            expect(body.error).toBeString();
        });
    });

    describe("GET /github/repos/:owner/:repo/contents", () => {
        test("returnerer rod-mappeindhold", async () => {
            const res = await app.request(
                "/github/repos/octocat/Hello-World/contents/?ref=main",
            );
            const body = (await res.json()) as ContentItem[];

            expect(res.status).toBe(200);
            expect(body).toBeArray();
            expect(body).toHaveLength(3);
            expect(body[0]?.downloadUrl).toBe(
                "https://raw.githubusercontent.com/octocat/Hello-World/main/README.md",
            );
        });

        test("returnerer enkelt fil med base64-indhold", async () => {
            const res = await app.request(
                "/github/repos/octocat/Hello-World/contents/README.md?ref=main",
            );
            const body = (await res.json()) as ContentFileEntry;

            expect(res.status).toBe(200);
            expect(body.name).toBe("README.md");
            expect(body.encoding).toBe("base64");
            expect(body.content).toBeString();
        });
    });

    describe("GET /github/repos/:owner/:repo/branches", () => {
        test("returnerer branches", async () => {
            const res = await app.request("/github/repos/octocat/Hello-World/branches");
            const body = (await res.json()) as Branch[];

            expect(res.status).toBe(200);
            expect(body).toHaveLength(2);
            expect(body[0]?.name).toBe("main");
        });
    });

    describe("GET /github/repos/:owner/:repo/commits", () => {
        test("returnerer commits og videresender Link-header", async () => {
            const res = await app.request(
                "/github/repos/octocat/Hello-World/commits?per_page=1&sha=main",
            );
            const body = (await res.json()) as unknown[];

            expect(res.status).toBe(200);
            expect(body).toHaveLength(1);
            expect(res.headers.get("Link")).toContain('rel="last"');
        });
    });
});
