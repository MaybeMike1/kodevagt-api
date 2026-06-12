import { describe, expect, test } from "bun:test";
import { deduplicateFindings, findingDedupKey } from "../src/features/review/review.dedup.ts";
import type { GeneratorFinding } from "../src/features/review/review.types.ts";

const duplicateFinding: GeneratorFinding = {
    id: "f1",
    severity: "warning",
    file: "src/features/auth/auth.routes.ts",
    line: 108,
    title: "Finding",
    body: "The redirectToFrontendWithError helper uses a hardcoded token_exchange_failed code.",
    confidence: 0.5,
};

describe("review.dedup", () => {
    test("findingDedupKey treats identical findings as same key", () => {
        const a = findingDedupKey(duplicateFinding);
        const b = findingDedupKey({ ...duplicateFinding, id: "f9", confidence: 0.9 });
        expect(a).toBe(b);
    });

    test("deduplicateFindings keeps one copy and highest confidence", () => {
        const findings = deduplicateFindings([
            duplicateFinding,
            { ...duplicateFinding, id: "f2", confidence: 0.82 },
            { ...duplicateFinding, id: "f3", confidence: 0.5 },
            { ...duplicateFinding, id: "f4", confidence: 0.5 },
            { ...duplicateFinding, id: "f5", confidence: 0.5 },
        ]);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.confidence).toBe(0.82);
        expect(findings[0]?.id).toBe("f1");
    });

    test("deduplicateFindings keeps distinct findings", () => {
        const findings = deduplicateFindings([
            duplicateFinding,
            {
                ...duplicateFinding,
                id: "f2",
                file: "src/other.ts",
                body: "Different issue in another file.",
            },
        ]);
        expect(findings).toHaveLength(2);
    });
});
