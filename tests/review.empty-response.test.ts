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
    ollamaChat: async () =>
        JSON.stringify({ summary: "", thoughtProcess: "", findings: [] }),
}));

import { app } from "../src/app.ts";
import { resetVectorStoreForTests } from "../src/features/vector/vector-store.ts";
import { MemoryVectorStore } from "../src/features/vector/memory-vector.store.ts";
import { buildCodeChunks } from "../src/features/vector/chunker.ts";
import { setIndexMeta } from "../src/features/indexing/index-meta.store.ts";
import { installGitHubFetchMock } from "./support/github-api-mock.ts";

describe("Review empty model response", () => {
    let restoreFetch: () => void;

    beforeAll(async () => {
        process.env.GITHUB_TOKEN = "test-token";
        process.env.VECTOR_STORE = "memory";
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
    });

    test("POST /review still returns summary, findings, and context", async () => {
        const res = await app.request("/review/repos/octocat/Hello-World/pulls/42", {
            method: "POST",
            headers: { Authorization: "Bearer test-token" },
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            summary: string;
            thoughtProcess: string;
            findings: unknown[];
            context: { changedFiles: number };
            usedFallback?: boolean;
        };
        expect(body.summary.length).toBeGreaterThan(0);
        expect(body.thoughtProcess.length).toBeGreaterThan(0);
        expect(body.findings.length).toBeGreaterThan(0);
        expect(body.context.changedFiles).toBe(2);
        expect(body.usedFallback).toBe(true);
    });
});
