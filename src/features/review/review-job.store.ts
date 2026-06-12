import type { ReviewResult } from "./review.types.ts";

export type ReviewJobStatus = "pending" | "running" | "completed" | "failed";

export type ReviewJob = {
    id: string;
    owner: string;
    repo: string;
    number: number;
    headSha: string;
    status: ReviewJobStatus;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    result?: ReviewResult;
};

const jobs = new Map<string, ReviewJob>();
const cache = new Map<string, { result: ReviewResult; storedAt: number }>();
const inflightByKey = new Map<string, string>();

const JOB_TTL_MS = 60 * 60 * 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function reviewCacheKey(
    owner: string,
    repo: string,
    number: number,
    headSha: string,
): string {
    return `${owner}/${repo}#${number}@${headSha}`;
}

function purgeExpired(): void {
    const now = Date.now();
    for (const [id, job] of jobs) {
        const age = now - Date.parse(job.createdAt);
        if (age > JOB_TTL_MS && job.status !== "running") {
            jobs.delete(id);
        }
    }
    for (const [key, entry] of cache) {
        if (now - entry.storedAt > CACHE_TTL_MS) {
            cache.delete(key);
        }
    }
}

export function getCachedReview(
    owner: string,
    repo: string,
    number: number,
    headSha: string,
): ReviewResult | null {
    purgeExpired();
    const hit = cache.get(reviewCacheKey(owner, repo, number, headSha));
    return hit?.result ?? null;
}

export function setCachedReview(
    owner: string,
    repo: string,
    number: number,
    headSha: string,
    result: ReviewResult,
): void {
    purgeExpired();
    cache.set(reviewCacheKey(owner, repo, number, headSha), {
        result,
        storedAt: Date.now(),
    });
}

export function getInflightJobId(
    owner: string,
    repo: string,
    number: number,
    headSha: string,
): string | null {
    purgeExpired();
    const jobId = inflightByKey.get(reviewCacheKey(owner, repo, number, headSha));
    if (!jobId) return null;
    const job = jobs.get(jobId);
    if (!job || job.status === "completed" || job.status === "failed") {
        inflightByKey.delete(reviewCacheKey(owner, repo, number, headSha));
        return null;
    }
    return jobId;
}

export function createReviewJob(params: {
    owner: string;
    repo: string;
    number: number;
    headSha: string;
}): ReviewJob {
    purgeExpired();
    const key = reviewCacheKey(params.owner, params.repo, params.number, params.headSha);
    const existingId = getInflightJobId(
        params.owner,
        params.repo,
        params.number,
        params.headSha,
    );
    if (existingId) {
        const existing = jobs.get(existingId);
        if (existing) return existing;
    }

    const job: ReviewJob = {
        id: crypto.randomUUID(),
        owner: params.owner,
        repo: params.repo,
        number: params.number,
        headSha: params.headSha,
        status: "pending",
        createdAt: new Date().toISOString(),
    };
    jobs.set(job.id, job);
    inflightByKey.set(key, job.id);
    return job;
}

export function getReviewJob(jobId: string): ReviewJob | null {
    purgeExpired();
    return jobs.get(jobId) ?? null;
}

export function markJobRunning(jobId: string): void {
    const job = jobs.get(jobId);
    if (!job) return;
    job.status = "running";
    job.startedAt = new Date().toISOString();
}

export function markJobCompleted(jobId: string, result: ReviewResult): void {
    const job = jobs.get(jobId);
    if (!job) return;
    job.status = "completed";
    job.completedAt = new Date().toISOString();
    job.result = result;
    setCachedReview(job.owner, job.repo, job.number, job.headSha, result);
    inflightByKey.delete(reviewCacheKey(job.owner, job.repo, job.number, job.headSha));
}

export function markJobFailed(jobId: string, error: string): void {
    const job = jobs.get(jobId);
    if (!job) return;
    job.status = "failed";
    job.completedAt = new Date().toISOString();
    job.error = error;
    inflightByKey.delete(reviewCacheKey(job.owner, job.repo, job.number, job.headSha));
}

/** Test helper */
export function resetReviewJobsForTests(): void {
    jobs.clear();
    cache.clear();
    inflightByKey.clear();
}
