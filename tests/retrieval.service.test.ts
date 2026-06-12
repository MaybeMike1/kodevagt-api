import { beforeEach, describe, expect, mock, test } from "bun:test";

const MOCK_EMBED = Array.from({ length: 768 }, (_, i) => (i % 10) * 0.01);

mock.module("../src/features/ai/ollama.client.ts", () => ({
    OllamaError: class extends Error {},
    ollamaEmbed: async (texts: string[]) => texts.map(() => [...MOCK_EMBED]),
    ollamaChat: async () =>
        JSON.stringify({
            scores: [
                { id: "c0", relevance: 0.9 },
                { id: "c1", relevance: 0.2 },
            ],
        }),
}));

import { retrieveForPullRequest } from "../src/features/retrieval/retrieval.service.ts";
import { clearIdfCacheForTests } from "../src/features/retrieval/retrieval.scoring.ts";
import { buildCodeChunks } from "../src/features/vector/chunker.ts";
import { MemoryVectorStore } from "../src/features/vector/memory-vector.store.ts";
import { resetVectorStoreForTests } from "../src/features/vector/vector-store.ts";

function makePr() {
    return {
        number: 1,
        title: "Add token revoke",
        body: "Revoke tokens on logout",
        state: "open" as const,
        baseRef: "main",
        headRef: "feature",
        changedFiles: 2,
        additions: 10,
        deletions: 2,
        url: "https://github.com/o/r/pull/1",
    };
}

describe("retrieveForPullRequest", () => {
    beforeEach(async () => {
        clearIdfCacheForTests();
        process.env.REVIEW_RERANKER_ENABLED = "false";
        process.env.REVIEW_GLOBAL_QUERY_ENABLED = "false";

        const store = new MemoryVectorStore();
        resetVectorStoreForTests(store);

        const authContent = [
            "export class AuthService {",
            "  validateToken(token: string) { return true; }",
            "  async revokeToken(token: string) { await store.delete(token); }",
            "}",
        ].join("\n");
        const utilContent = "export function hashToken(t: string) { return t; }";

        const authChunks = buildCodeChunks({
            owner: "o",
            repo: "r",
            ref: "main",
            path: "src/auth.ts",
            fileSha: "a",
            content: authContent,
            embeddings: [MOCK_EMBED, MOCK_EMBED],
        });
        const utilChunks = buildCodeChunks({
            owner: "o",
            repo: "r",
            ref: "main",
            path: "src/util.ts",
            fileSha: "b",
            content: utilContent,
            embeddings: [MOCK_EMBED],
        });
        await store.upsertChunks([...authChunks, ...utilChunks]);
    });

    test("caps snippets and prioritizes changed-file overlap", async () => {
        process.env.REVIEW_MAX_SNIPPETS = "4";

        const patch = `@@ -2,3 +2,4 @@ export class AuthService {
   validateToken(token: string) { return true; }
+  async revokeToken(token: string) { await store.delete(token); }
 }`;

        const result = await retrieveForPullRequest({
            owner: "o",
            repo: "r",
            ref: "main",
            pr: makePr(),
            files: [
                {
                    filename: "src/auth.ts",
                    status: "modified",
                    additions: 1,
                    deletions: 0,
                    changes: 1,
                    patch,
                },
            ],
        });

        expect(result.snippets.length).toBeLessThanOrEqual(4);
        expect(result.snippets.some((s) => s.path === "src/auth.ts")).toBe(true);
        expect(result.snippets[0]!.path).toBe("src/auth.ts");
        expect(result.snippets.every((s) => s.rerankScore > 0)).toBe(true);
    });

    test("dedupes across file queries and sorts by rerank score", async () => {
        process.env.REVIEW_MAX_SNIPPETS = "8";

        const patch = `@@ -1,1 +1,2 @@
 export class AuthService {
+  async revokeToken(token: string) {}
 }`;

        const result = await retrieveForPullRequest({
            owner: "o",
            repo: "r",
            ref: "main",
            pr: makePr(),
            files: [
                {
                    filename: "src/auth.ts",
                    status: "modified",
                    additions: 1,
                    deletions: 0,
                    changes: 1,
                    patch,
                },
            ],
        });

        const keys = result.snippets.map((s) => `${s.path}:${s.chunkIndex}`);
        expect(new Set(keys).size).toBe(keys.length);
        for (let i = 1; i < result.snippets.length; i++) {
            expect(result.snippets[i - 1]!.rerankScore).toBeGreaterThanOrEqual(
                result.snippets[i]!.rerankScore,
            );
        }
    });
});
