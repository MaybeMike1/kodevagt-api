import { describe, expect, test } from "bun:test";
import {
    computeAccuracyScore,
    computeReviewMetrics,
    filterFindingsByQuality,
    isCitationValid,
    mergeFindingsWithValidations,
    selectFindingsForResponse,
} from "../src/features/review/review.metrics.ts";
import type { GeneratorFinding } from "../src/features/review/review.types.ts";

describe("review.metrics", () => {
    test("citation valid when file in patch", () => {
        const finding: GeneratorFinding = {
            id: "f1",
            severity: "warning",
            file: "src/a.ts",
            title: "t",
            body: "b",
            confidence: 0.8,
        };
        const files = [
            {
                filename: "src/a.ts",
                status: "modified" as const,
                additions: 1,
                deletions: 0,
                changes: 1,
                patch: "@@ -1,1 +1,2 @@\n line\n+new\n",
                previousFilename: null,
            },
        ];
        expect(isCitationValid(finding, files)).toBe(true);
    });

    test("citation valid when file matches even if line is in hunk range only", () => {
        const finding: GeneratorFinding = {
            id: "f1",
            severity: "warning",
            file: "src/auth.ts",
            line: 108,
            title: "t",
            body: "b",
            confidence: 0.68,
        };
        const files = [
            {
                filename: "src/auth.ts",
                status: "modified" as const,
                additions: 3,
                deletions: 1,
                changes: 4,
                patch: "@@ -105,7 +105,9 @@\n context\n-old\n+new line\n more",
                previousFilename: null,
            },
        ];
        expect(isCitationValid(finding, files)).toBe(true);
    });

    test("citation invalid when file not in PR", () => {
        const finding: GeneratorFinding = {
            id: "f1",
            severity: "warning",
            file: "src/missing.ts",
            line: 1,
            title: "t",
            body: "b",
            confidence: 0.5,
        };
        expect(isCitationValid(finding, [])).toBe(false);
    });

    test("computeReviewMetrics aggregates scores", () => {
        const findings = mergeFindingsWithValidations(
            [
                {
                    id: "f1",
                    severity: "warning",
                    title: "Issue",
                    body: "Details",
                    confidence: 0.9,
                    file: "a.ts",
                },
            ],
            [
                {
                    findingId: "f1",
                    verdict: "supported",
                    confidence: 0.85,
                    rationale: "seen in diff",
                },
            ],
            [],
        );
        const metrics = computeReviewMetrics(findings);
        expect(metrics.findingCount).toBe(1);
        expect(metrics.supportedRate).toBe(1);
        expect(metrics.overallAccuracy).toBeGreaterThan(0.5);
    });

    test("selectFindingsForResponse falls back to relaxed tier", () => {
        const merged = mergeFindingsWithValidations(
            [
                {
                    id: "f1",
                    severity: "warning",
                    title: "Partial match",
                    body: "Issue visible in the diff hunk for this handler.",
                    confidence: 0.72,
                    file: "a.ts",
                    line: 10,
                },
            ],
            [
                {
                    findingId: "f1",
                    verdict: "partial",
                    confidence: 0.7,
                    rationale: "plausible from diff",
                },
            ],
            [
                {
                    filename: "a.ts",
                    status: "modified" as const,
                    additions: 1,
                    deletions: 0,
                    changes: 1,
                    patch: "@@ -8,3 +8,4 @@\n ctx\n+new\n",
                    previousFilename: null,
                },
            ],
        );

        const strict = selectFindingsForResponse(merged, {
            targetConfidence: 0.8,
            minConfidence: 0.65,
            requireSupported: false,
            verifierRan: true,
            allowFallback: true,
        });
        expect(strict.tier).toBe("relaxed");
        expect(strict.findings).toHaveLength(1);
        expect(strict.findings[0]?.confidence).toBeGreaterThanOrEqual(0.65);
    });

    test("selectFindingsForResponse uses best-effort when strict and relaxed empty", () => {
        const merged = mergeFindingsWithValidations(
            [
                {
                    id: "f1",
                    severity: "info",
                    title: "Weak",
                    body: "Minor style note on changed file.",
                    confidence: 0.58,
                    file: "a.ts",
                },
            ],
            [
                {
                    findingId: "f1",
                    verdict: "partial",
                    confidence: 0.6,
                    rationale: "weak",
                },
            ],
            [
                {
                    filename: "a.ts",
                    status: "modified" as const,
                    additions: 1,
                    deletions: 0,
                    changes: 1,
                    patch: "+x",
                    previousFilename: null,
                },
            ],
        );

        const result = selectFindingsForResponse(merged, {
            targetConfidence: 0.8,
            minConfidence: 0.65,
            requireSupported: false,
            verifierRan: true,
            allowFallback: true,
        });
        expect(result.tier).toBe("relaxed");
        expect(result.findings).toHaveLength(1);
    });

    test("filterFindingsByQuality drops low confidence and unsupported", () => {
        const merged = mergeFindingsWithValidations(
            [
                {
                    id: "f1",
                    severity: "warning",
                    title: "High",
                    body: "Clear issue in diff.",
                    confidence: 0.9,
                    file: "a.ts",
                },
                {
                    id: "f2",
                    severity: "info",
                    title: "Low",
                    body: "Maybe.",
                    confidence: 0.5,
                    file: "b.ts",
                },
            ],
            [
                {
                    findingId: "f1",
                    verdict: "supported",
                    confidence: 0.9,
                    rationale: "in diff",
                },
                {
                    findingId: "f2",
                    verdict: "partial",
                    confidence: 0.5,
                    rationale: "weak",
                },
            ],
            [
                {
                    filename: "a.ts",
                    status: "modified" as const,
                    additions: 1,
                    deletions: 0,
                    changes: 1,
                    patch: "@@ +1 @@\n+x",
                    previousFilename: null,
                },
            ],
        );

        const filtered = filterFindingsByQuality(merged, {
            minConfidence: 0.8,
            requireSupported: true,
            verifierRan: true,
        });
        expect(filtered).toHaveLength(1);
        expect(filtered[0]?.id).toBe("f1");
        expect(filtered[0]?.confidence).toBeGreaterThanOrEqual(0.8);
    });

    test("hallucinated verdict lowers accuracy score", () => {
        const score = computeAccuracyScore(
            {
                id: "f1",
                severity: "critical",
                title: "x",
                body: "y",
                confidence: 0.9,
            },
            {
                findingId: "f1",
                verdict: "hallucinated",
                confidence: 0.9,
                rationale: "not in diff",
            },
            false,
        );
        expect(score).toBeLessThan(0.5);
    });
});
