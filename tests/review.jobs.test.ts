import { describe, expect, test, beforeEach } from "bun:test";
import {
    createReviewJob,
    getCachedReview,
    getReviewJob,
    markJobCompleted,
    resetReviewJobsForTests,
    setCachedReview,
} from "../src/features/review/review-job.store.ts";
import type { ReviewResult } from "../src/features/review/review.types.ts";

const stubResult = (overrides: Partial<ReviewResult> = {}): ReviewResult => ({
    reviewId: "r1",
    summary: "ok",
    thoughtProcess: "",
    findings: [],
    metrics: {
        overallAccuracy: 0,
        supportedRate: 0,
        hallucinationRate: 0,
        avgGeneratorConfidence: 0,
        avgVerifierConfidence: 0,
        citationAccuracy: 0,
        findingCount: 0,
    },
    context: {
        changedFiles: 0,
        filesWithPatch: 0,
        filesWithoutPatch: 0,
        ragSnippetCount: 0,
    },
    model: "m",
    verifierModel: "v",
    indexedRef: "main",
    durationMs: 1,
    ...overrides,
});

describe("review job store", () => {
    beforeEach(() => resetReviewJobsForTests());

    test("creates pending job", () => {
        const job = createReviewJob({
            owner: "o",
            repo: "r",
            number: 1,
            headSha: "sha1",
        });
        expect(job.status).toBe("pending");
        expect(getReviewJob(job.id)?.id).toBe(job.id);
    });

    test("caches completed reviews by head sha", () => {
        const job = createReviewJob({
            owner: "o",
            repo: "r",
            number: 1,
            headSha: "sha1",
        });
        markJobCompleted(job.id, stubResult({ reviewId: "r1", headSha: "sha1" }));
        expect(getCachedReview("o", "r", 1, "sha1")?.reviewId).toBe("r1");
    });

    test("setCachedReview stores result", () => {
        setCachedReview("a", "b", 2, "sha2", stubResult({ reviewId: "r2", summary: "cached" }));
        expect(getCachedReview("a", "b", 2, "sha2")?.summary).toBe("cached");
    });
});
