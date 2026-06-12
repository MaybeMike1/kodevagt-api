import { describe, expect, test } from "bun:test";
import { chunkFileContent } from "../src/features/vector/chunker.ts";
import { shouldSkipPath } from "../src/features/vector/denylist.ts";

describe("chunker", () => {
    test("splits large file into multiple chunks", () => {
        const lines = Array.from({ length: 400 }, (_, i) => `function fn${i}() { return ${i}; }`);
        const content = lines.join("\n");
        const chunks = chunkFileContent("src/a.ts", content, { maxChars: 500, overlapRatio: 0.1 });
        expect(chunks.length).toBeGreaterThan(1);
    });

    test("denylist skips node_modules", () => {
        expect(shouldSkipPath("node_modules/pkg/index.js")).toBe(true);
        expect(shouldSkipPath("src/index.ts")).toBe(false);
    });
});
