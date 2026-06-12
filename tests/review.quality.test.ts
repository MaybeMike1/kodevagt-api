import { describe, expect, test } from "bun:test";
import { ensureGeneratorOutput } from "../src/features/review/review.fallback.ts";
import {
    hasSubstantiveFindings,
    isSubstantiveFinding,
} from "../src/features/review/review.quality.ts";

describe("review.quality", () => {
    test("isSubstantiveFinding rejects empty placeholders", () => {
        expect(
            isSubstantiveFinding({ title: "Finding", body: "", file: undefined }),
        ).toBe(false);
        expect(
            isSubstantiveFinding({
                title: "Missing null check",
                body: "The handler does not guard against null input before dereferencing.",
                file: "src/a.ts",
            }),
        ).toBe(true);
    });

    test("ensureGeneratorOutput replaces skeleton findings with per-file fallbacks", () => {
        const files = [
            {
                filename: "src/a.ts",
                status: "modified" as const,
                additions: 2,
                deletions: 1,
                changes: 3,
                patch: "@@\n+const x = 1;\n",
                previousFilename: null,
            },
        ];
        const out = ensureGeneratorOutput(
            {
                summary: "",
                thoughtProcess: "",
                findings: Array.from({ length: 8 }, (_, i) => ({
                    id: `f${i + 1}`,
                    severity: "suggestion" as const,
                    title: "Finding",
                    body: "",
                    confidence: 0.5,
                })),
            },
            files,
            {
                changedFiles: 1,
                filesWithPatch: 1,
                filesWithoutPatch: 0,
                ragSnippetCount: 0,
            },
        );
        expect(hasSubstantiveFindings(out.findings)).toBe(true);
        expect(out.usedFallback).toBe(true);
        expect(out.findings[0]?.file).toBe("src/a.ts");
        expect(out.findings[0]?.body.length).toBeGreaterThan(20);
    });
});
