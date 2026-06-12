import { describe, expect, mock, test } from "bun:test";

mock.module("../src/features/ai/ollama.client.ts", () => ({
    OllamaError: class extends Error {},
    ollamaChat: async (
        messages: Array<{ role: string; content: string }>,
        options?: { model?: string; format?: string },
    ) => {
        const last = messages[messages.length - 1]?.content ?? "";
        if (last.includes("BREAK_JSON")) return "not json at all";
        if (last.includes("EMPTY_SCORES")) return JSON.stringify({ scores: [] });
        // Echo a valid response — score c0 high, c1 low.
        if (options?.format !== "json") throw new Error("expected json format");
        return JSON.stringify({
            scores: [
                { id: "c0", relevance: 0.95 },
                { id: "c1", relevance: 0.1 },
            ],
        });
    },
}));

import { llmRerank } from "../src/features/retrieval/retrieval.reranker.ts";
import type { RetrievalHit } from "../src/features/retrieval/retrieval.types.ts";
import type { CodeChunk } from "../src/features/vector/vector.types.ts";

function makeHit(id: string, path: string, content: string): RetrievalHit {
    const chunk: CodeChunk = {
        id,
        owner: "o",
        repo: "r",
        ref: "main",
        path,
        chunkIndex: 0,
        content,
        embedding: [],
        language: "ts",
        symbolNames: [],
        imports: [],
        lineStart: 1,
        lineEnd: 5,
        fileSha: "sha",
        indexedAt: new Date().toISOString(),
        isTest: false,
        directory: "",
    };
    return { chunk, vectorScore: 0, keywordScore: 0, fusedScore: 0, rerankScore: 0 };
}

describe("llmRerank", () => {
    test("returns indexed scores from valid JSON response", async () => {
        const hits = [
            makeHit("a", "src/a.ts", "relevant content"),
            makeHit("b", "src/b.ts", "unrelated content"),
        ];
        const scores = await llmRerank(
            { text: "find a", intent: "find a", symbols: [] },
            hits,
        );
        expect(scores.get(0)).toBeCloseTo(0.95);
        expect(scores.get(1)).toBeCloseTo(0.1);
    });

    test("returns empty map when LLM returns non-JSON", async () => {
        const hits = [makeHit("a", "src/a.ts", "BREAK_JSON content")];
        const scores = await llmRerank(
            { text: "BREAK_JSON", intent: "BREAK_JSON", symbols: [] },
            hits,
        );
        expect(scores.size).toBe(0);
    });

    test("returns empty map for empty input", async () => {
        const scores = await llmRerank({ text: "" }, []);
        expect(scores.size).toBe(0);
    });

    test("handles empty scores array gracefully", async () => {
        const hits = [makeHit("a", "src/a.ts", "EMPTY_SCORES content")];
        const scores = await llmRerank(
            { text: "EMPTY_SCORES", intent: "EMPTY_SCORES", symbols: [] },
            hits,
        );
        expect(scores.size).toBe(0);
    });
});
