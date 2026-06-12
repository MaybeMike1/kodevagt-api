import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

const MOCK_EMBED = Array.from({ length: 768 }, (_, i) => (i % 10) * 0.01);

mock.module("../src/features/ai/ollama.client.ts", () => ({
    OllamaError: class OllamaError extends Error {},
    ollamaHealth: async () => ({
        ok: true,
        models: ["nomic-embed-text", "qwen2.5-coder:7b"],
    }),
    assertOllamaChatReady: () => {},
    assertOllamaReady: () => {},
    ollamaEmbed: async (texts: string[]) => texts.map(() => [...MOCK_EMBED]),
    ollamaChat: async (messages: Array<{ role: string; content: string }>) => {
        const last = messages[messages.length - 1]?.content ?? "";
        if (last.includes("validate") || last.includes("Findings to validate")) {
            return JSON.stringify({
                validations: [
                    {
                        findingId: "f1",
                        verdict: "supported",
                        confidence: 0.8,
                        rationale: "Matches diff.",
                    },
                ],
            });
        }
        return JSON.stringify({
            thoughtProcess: "Checked diff and context.",
            summary: "Looks good with one suggestion.",
            findings: [
                {
                    id: "f1",
                    severity: "suggestion",
                    file: "README.md",
                    title: "Consider docs",
                    body: "Update README for new behavior.",
                    confidence: 0.85,
                },
            ],
        });
    },
}));

import { app } from "../src/app.ts";
import { resetReviewJobsForTests } from "../src/features/review/review-job.store.ts";
import { setIndexMeta } from "../src/features/indexing/index-meta.store.ts";
import { buildCodeChunks } from "../src/features/vector/chunker.ts";
import { MemoryVectorStore } from "../src/features/vector/memory-vector.store.ts";
import { resetVectorStoreForTests } from "../src/features/vector/vector-store.ts";
import { installGitHubFetchMock } from "./support/github-api-mock.ts";

async function pollReviewJob(jobId: string, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const res = await app.request(`/review/jobs/${jobId}`, {
            headers: { Authorization: "Bearer test-token" },
        });
        const job = (await res.json()) as {
            status: string;
            result?: { reviewId: string };
            error?: string;
        };
        if (job.status === "completed" && job.result) return job;
        if (job.status === "failed") throw new Error(job.error ?? "review failed");
        await Bun.sleep(100);
    }
    throw new Error("Review job timed out");
}

describe("Review async routes", () => {
    let restoreFetch: () => void;

    beforeAll(async () => {
        process.env.GITHUB_TOKEN = "test-token";
        process.env.VECTOR_STORE = "memory";
        process.env.REVIEW_ASYNC = "true";
        restoreFetch = installGitHubFetchMock();
        resetReviewJobsForTests();

        const store = new MemoryVectorStore();
        resetVectorStoreForTests(store);
        await store.upsertChunks(
            buildCodeChunks({
                owner: "octocat",
                repo: "Hello-World",
                ref: "main",
                path: "README.md",
                fileSha: "abc",
                content: "# Hello\n\nSome docs here.",
                embeddings: [MOCK_EMBED],
            }),
        );
        setIndexMeta({
            owner: "octocat",
            repo: "Hello-World",
            ref: "main",
            treeSha: "tree-sha",
            chunkCount: 1,
            fileCount: 1,
            status: "ready",
            completedAt: new Date().toISOString(),
        });
    });

    afterAll(() => {
        restoreFetch();
        resetReviewJobsForTests();
        delete process.env.GITHUB_TOKEN;
        delete process.env.VECTOR_STORE;
        delete process.env.REVIEW_ASYNC;
    });

    test("GET /review/jobs/:id returns 404 for unknown job", async () => {
        const res = await app.request("/review/jobs/not-a-real-id", {
            headers: { Authorization: "Bearer test-token" },
        });
        expect(res.status).toBe(404);
    });

    test("POST /review returns 202 and job completes via polling", async () => {
        resetReviewJobsForTests();
        const res = await app.request("/review/repos/octocat/Hello-World/pulls/42?force=true", {
            method: "POST",
            headers: { Authorization: "Bearer test-token" },
        });
        expect(res.status).toBe(202);
        const started = (await res.json()) as { jobId: string; status: string; pollUrl: string };
        expect(["pending", "running"]).toContain(started.status);
        expect(started.pollUrl).toContain(started.jobId);

        const done = await pollReviewJob(started.jobId);
        expect(done.result?.reviewId).toBeTruthy();
    });

    test("POST /review returns cached result on repeat request", async () => {
        const first = await app.request("/review/repos/octocat/Hello-World/pulls/42", {
            method: "POST",
            headers: { Authorization: "Bearer test-token" },
        });
        if (first.status === 202) {
            const job = (await first.json()) as { jobId: string };
            await pollReviewJob(job.jobId);
        }

        const second = await app.request("/review/repos/octocat/Hello-World/pulls/42", {
            method: "POST",
            headers: { Authorization: "Bearer test-token" },
        });
        expect(second.status).toBe(200);
        const body = (await second.json()) as { fromCache?: boolean; headSha?: string };
        expect(body.fromCache).toBe(true);
        expect(body.headSha).toBeTruthy();
    });

    test("POST /review?sync=true blocks until complete", async () => {
        const res = await app.request("/review/repos/octocat/Hello-World/pulls/42?sync=true", {
            method: "POST",
            headers: { Authorization: "Bearer test-token" },
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { summary: string; findings: unknown[] };
        expect(body.summary).toContain("suggestion");
        expect(body.findings.length).toBeGreaterThan(0);
    });
});
