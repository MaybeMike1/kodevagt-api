import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

const MOCK_EMBED = Array.from({ length: 768 }, (_, i) => (i % 10) * 0.01);

mock.module("../src/features/ai/ollama.client.ts", () => ({
    OllamaError: class OllamaError extends Error {},
    ollamaHealth: async () => ({
        ok: true,
        models: ["nomic-embed-text", "qwen2.5-coder:7b"],
    }),
    assertOllamaChatReady: () => {},
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
import { resetVectorStoreForTests } from "../src/features/vector/vector-store.ts";
import { MemoryVectorStore } from "../src/features/vector/memory-vector.store.ts";
import { buildCodeChunks } from "../src/features/vector/chunker.ts";
import { setIndexMeta } from "../src/features/indexing/index-meta.store.ts";
import { installGitHubFetchMock } from "./support/github-api-mock.ts";

describe("Review routes", () => {
    let restoreFetch: () => void;

    beforeAll(async () => {
        process.env.GITHUB_TOKEN = "test-token";
        process.env.VECTOR_STORE = "memory";
        process.env.REVIEW_ASYNC = "false";
        restoreFetch = installGitHubFetchMock();

        const store = new MemoryVectorStore();
        resetVectorStoreForTests(store);
        const chunks = buildCodeChunks({
            owner: "octocat",
            repo: "Hello-World",
            ref: "main",
            path: "README.md",
            fileSha: "abc",
            content: "# Hello\n\nSome docs here.",
            embeddings: [MOCK_EMBED],
        });
        await store.upsertChunks(chunks);
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
        delete process.env.GITHUB_TOKEN;
        delete process.env.VECTOR_STORE;
        delete process.env.REVIEW_ASYNC;
    });

    test("GET /review/health returns ollama status", async () => {
        const res = await app.request("/review/health", {
            headers: { Authorization: "Bearer test-token" },
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ollama: { ok: boolean } };
        expect(body.ollama.ok).toBe(true);
    });

    test("POST /review returns 409 when repo not indexed", async () => {
        const res = await app.request("/review/repos/octocat/Unknown-Repo/pulls/42", {
            method: "POST",
            headers: { Authorization: "Bearer test-token" },
        });
        expect(res.status).toBe(409);
    });

    test("POST /review rejects Undefined repo slug", async () => {
        const res = await app.request("/review/repos/MaybeMike1/Undefined/pulls/1", {
            method: "POST",
            headers: { Authorization: "Bearer test-token" },
        });
        expect(res.status).toBe(400);
    });

    test("POST /review runs two-pass review when indexed", async () => {
        const res = await app.request("/review/repos/octocat/Hello-World/pulls/42", {
            method: "POST",
            headers: { Authorization: "Bearer test-token" },
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            summary: string;
            thoughtProcess: string;
            findings: Array<{ id: string; confidence: number; accuracyScore: number }>;
            metrics: { findingCount: number; overallAccuracy: number };
        };
        expect(body.summary).toContain("suggestion");
        expect(body.thoughtProcess).toContain("Checked");
        expect(body.findings).toHaveLength(1);
        expect(body.metrics.findingCount).toBe(1);
        expect(body.findings[0]?.confidence).toBeGreaterThanOrEqual(0.8);
        expect(body.findings[0]?.accuracyScore).toBeGreaterThan(0);
    });
});
