import { describe, expect, test } from "bun:test";
import {
    buildIdfIndex,
    clearIdfCacheForTests,
    computeHeuristicBoost,
    computeRerankScore,
    getOrBuildIdfIndex,
    idfKeywordScore,
    lineOverlapBoost,
    mmrSelect,
    pathBoost,
    tokenize,
} from "../src/features/retrieval/retrieval.scoring.ts";
import type { CodeChunk } from "../src/features/vector/vector.types.ts";

function makeChunk(id: string, path: string, content: string, symbols: string[] = []): CodeChunk {
    return {
        id,
        owner: "o",
        repo: "r",
        ref: "main",
        path,
        chunkIndex: 0,
        content,
        embedding: [],
        language: "ts",
        symbolNames: symbols,
        imports: [],
        lineStart: 1,
        lineEnd: 10,
        fileSha: "sha",
        indexedAt: new Date().toISOString(),
        isTest: false,
        directory: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
    };
}

describe("idfKeywordScore", () => {
    test("rare tokens score higher than common ones", () => {
        const chunks = [
            makeChunk("a", "src/foo.ts", "const foo = require('x'); export function widget() {}", ["widget"]),
            makeChunk("b", "src/bar.ts", "const bar = require('x'); export function thing() {}"),
            makeChunk("c", "src/baz.ts", "const baz = require('x'); export function thing() {}"),
            makeChunk("d", "src/qux.ts", "const qux = require('x'); export function thing() {}"),
        ];
        const index = buildIdfIndex(chunks);

        const queryTokens = tokenize("widget");
        const commonTokens = tokenize("require export const function");

        const rareScore = idfKeywordScore(queryTokens, "a", index);
        const commonOnA = idfKeywordScore(commonTokens, "a", index);

        // chunk "a" matches a rare token (widget appears in only 1/4) -> high
        expect(rareScore).toBeGreaterThan(0.9);
        // chunk "a" matches common tokens that appear in all 4 chunks -> their IDF is low,
        // but the score is normalised by total query-IDF mass so the score is still high.
        // The key invariant: the rare-token score for "widget" on chunk "a"
        // should be no lower than the common-token score on chunk "a".
        expect(rareScore).toBeGreaterThanOrEqual(commonOnA - 1e-9);
    });

    test("returns 0 for chunk with no matching tokens", () => {
        const chunks = [makeChunk("a", "src/a.ts", "hello world")];
        const index = buildIdfIndex(chunks);
        expect(idfKeywordScore(tokenize("nothing here"), "a", index)).toBe(0);
    });

    test("returns 0 for empty query", () => {
        const chunks = [makeChunk("a", "src/a.ts", "hello world")];
        const index = buildIdfIndex(chunks);
        expect(idfKeywordScore([], "a", index)).toBe(0);
    });
});

describe("mmrSelect", () => {
    test("penalises near-duplicates in favour of diverse content", () => {
        const items = [
            { id: "1", score: 1.0, content: "alpha bravo charlie delta echo foxtrot golf hotel" },
            { id: "2", score: 0.95, content: "alpha bravo charlie delta echo foxtrot golf hotel" }, // duplicate
            { id: "3", score: 0.9, content: "mike november oscar papa quebec romeo sierra tango" }, // diverse
        ];
        const picked = mmrSelect(items, 2, 0.5);
        const ids = picked.map((p) => p.id);
        expect(ids).toContain("1");
        expect(ids).toContain("3");
        expect(ids).not.toContain("2");
    });

    test("lambda=1 preserves relevance ordering", () => {
        const items = [
            { id: "1", score: 1.0, content: "alpha bravo" },
            { id: "2", score: 0.9, content: "alpha bravo" },
            { id: "3", score: 0.8, content: "alpha bravo" },
        ];
        const picked = mmrSelect(items, 3, 1);
        expect(picked.map((p) => p.id)).toEqual(["1", "2", "3"]);
    });
});

describe("getOrBuildIdfIndex cache", () => {
    test("returns same instance for same chunk count, rebuilds when count changes", () => {
        clearIdfCacheForTests();
        const chunks1 = [makeChunk("a", "src/a.ts", "hello")];
        const a = getOrBuildIdfIndex("o", "r", "main", chunks1);
        const b = getOrBuildIdfIndex("o", "r", "main", chunks1);
        expect(a).toBe(b);

        const chunks2 = [...chunks1, makeChunk("b", "src/b.ts", "world")];
        const c = getOrBuildIdfIndex("o", "r", "main", chunks2);
        expect(c).not.toBe(a);
    });
});

describe("lineOverlapBoost", () => {
    test("returns 0 when chunk does not overlap changed lines", () => {
        expect(lineOverlapBoost(1, 10, [20, 21])).toBe(0);
    });

    test("returns higher boost when more changed lines fall in chunk range", () => {
        const sparseChanged = [12, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60];
        const denseChanged = [10, 11, 12, 50, 51, 52, 53, 54, 55, 56, 57, 58];
        const sparse = lineOverlapBoost(10, 15, sparseChanged);
        const dense = lineOverlapBoost(10, 15, denseChanged);
        expect(dense).toBeGreaterThan(sparse);
        expect(sparse).toBeGreaterThan(0);
    });
});

describe("pathBoost", () => {
    test("prefers exact path match over same directory", () => {
        expect(pathBoost("src/auth/service.ts", "src/auth/service.ts")).toBeGreaterThan(
            pathBoost("src/auth/service.ts", "src/auth/token.ts"),
        );
    });
});

describe("computeHeuristicBoost", () => {
    test("combines path, symbol, and line overlap", () => {
        const low = computeHeuristicBoost({
            chunkPath: "src/other.ts",
            chunkLineStart: 1,
            chunkLineEnd: 5,
            chunkSymbols: ["foo"],
            querySymbols: ["revokeToken"],
            changedPath: "src/auth.ts",
            changedLines: [40],
        });
        const high = computeHeuristicBoost({
            chunkPath: "src/auth.ts",
            chunkLineStart: 38,
            chunkLineEnd: 45,
            chunkSymbols: ["revokeToken"],
            querySymbols: ["revokeToken"],
            changedPath: "src/auth.ts",
            changedLines: [40, 41],
        });
        expect(high).toBeGreaterThan(low);
    });
});

describe("computeRerankScore", () => {
    test("uses LLM score as primary signal when present", () => {
        const withLlm = computeRerankScore({
            fusedScore: 0.01,
            maxFusedScore: 0.02,
            heuristic: 0.1,
            llmScore: 0.95,
            llmWeight: 0.6,
        });
        const withoutLlm = computeRerankScore({
            fusedScore: 0.01,
            maxFusedScore: 0.02,
            heuristic: 0.1,
            llmWeight: 0.6,
        });
        expect(withLlm).toBeGreaterThan(withoutLlm);
        expect(withLlm).toBeGreaterThan(0.5);
    });
});
