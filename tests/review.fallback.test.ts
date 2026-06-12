import { describe, expect, test } from "bun:test";
import { buildFallbackFindings, ensureGeneratorOutput } from "../src/features/review/review.fallback.ts";

describe("review.fallback", () => {
    test("ensureGeneratorOutput adds fallback findings when empty", () => {
        const files = [
            {
                filename: "src/a.ts",
                status: "modified" as const,
                additions: 1,
                deletions: 0,
                changes: 1,
                patch: "@@ -1 +1 @@\n+x",
                previousFilename: null,
            },
        ];
        const stats = {
            changedFiles: 1,
            filesWithPatch: 1,
            filesWithoutPatch: 0,
            ragSnippetCount: 2,
        };
        const out = ensureGeneratorOutput(
            { summary: "", thoughtProcess: "", findings: [] },
            files,
            stats,
        );
        expect(out.findings.length).toBeGreaterThan(0);
        expect(out.summary.length).toBeGreaterThan(0);
        expect(out.usedFallback).toBe(true);
    });

    test("ensureGeneratorOutput warns when GitHub files list is empty but PR has changes", () => {
        const out = ensureGeneratorOutput(
            { summary: "", thoughtProcess: "", findings: [] },
            [],
            {
                changedFiles: 0,
                filesWithPatch: 0,
                filesWithoutPatch: 0,
                ragSnippetCount: 0,
            },
            3,
        );
        expect(out.findings[0]?.title).toContain("Could not load PR file list");
        expect(out.usedFallback).toBe(true);
    });

    test("buildFallbackFindings for files without patch", () => {
        const findings = buildFallbackFindings(
            [
                {
                    filename: "big.ts",
                    status: "modified",
                    additions: 100,
                    deletions: 50,
                    changes: 150,
                    patch: null,
                    previousFilename: null,
                },
            ],
            {
                changedFiles: 1,
                filesWithPatch: 0,
                filesWithoutPatch: 1,
                ragSnippetCount: 3,
            },
        );
        expect(findings[0]?.body).toContain("GitHub omitted");
    });
});
