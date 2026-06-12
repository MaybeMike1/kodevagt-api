import { OllamaError } from "../ai/ollama.client.ts";
import type { GitHubAuth } from "../github/github.client.ts";
import {
    createReviewJob,
    getCachedReview,
    getInflightJobId,
    getReviewJob,
    markJobCompleted,
    markJobFailed,
    markJobRunning,
    setCachedReview,
} from "./review-job.store.ts";
import { runPullRequestReview } from "./review.service.ts";
import type { ReviewJobResponse, ReviewResult } from "./review.types.ts";

function jobToResponse(job: NonNullable<ReturnType<typeof getReviewJob>>): ReviewJobResponse {
    return {
        jobId: job.id,
        status: job.status,
        pollUrl: `/review/jobs/${job.id}`,
        owner: job.owner,
        repo: job.repo,
        number: job.number,
        headSha: job.headSha,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        error: job.error,
        result: job.result,
    };
}

export async function startReviewJob(params: {
    owner: string;
    repo: string;
    number: number;
    auth: GitHubAuth;
    includeDebug?: boolean;
    force?: boolean;
}): Promise<
    | { kind: "cached"; result: ReviewResult }
    | { kind: "job"; job: ReviewJobResponse }
> {
    const { getPullRequest } = await import("../github/github.client.ts");
    const pr = await getPullRequest(
        { owner: params.owner, repo: params.repo, number: params.number },
        params.auth,
    );
    const headSha = pr.headSha || "unknown";

    if (!params.force) {
        const cached = getCachedReview(params.owner, params.repo, params.number, headSha);
        if (cached) {
            return { kind: "cached", result: { ...cached, fromCache: true, headSha } };
        }
    }

    const existingId = getInflightJobId(params.owner, params.repo, params.number, headSha);
    if (existingId && !params.force) {
        const existing = getReviewJob(existingId);
        if (existing) return { kind: "job", job: jobToResponse(existing) };
    }

    const job = createReviewJob({
        owner: params.owner,
        repo: params.repo,
        number: params.number,
        headSha,
    });

    void executeReviewJob(job.id, params).catch(() => {
        // errors handled inside executeReviewJob
    });

    return { kind: "job", job: jobToResponse(job) };
}

async function executeReviewJob(
    jobId: string,
    params: {
        owner: string;
        repo: string;
        number: number;
        auth: GitHubAuth;
        includeDebug?: boolean;
    },
): Promise<void> {
    markJobRunning(jobId);
    try {
        const result = await runPullRequestReview({
            owner: params.owner,
            repo: params.repo,
            number: params.number,
            auth: params.auth,
            includeDebug: params.includeDebug,
        });
        markJobCompleted(jobId, result);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Review failed";
        markJobFailed(jobId, message);
        if (!(err instanceof OllamaError)) {
            console.error("[review-job]", jobId, message);
        }
    }
}

export function getReviewJobStatus(jobId: string): ReviewJobResponse | null {
    const job = getReviewJob(jobId);
    if (!job) return null;
    return jobToResponse(job);
}

export async function runSyncReview(params: {
    owner: string;
    repo: string;
    number: number;
    auth: GitHubAuth;
    includeDebug?: boolean;
    force?: boolean;
}): Promise<ReviewResult> {
    const { getPullRequest } = await import("../github/github.client.ts");
    const pr = await getPullRequest(
        { owner: params.owner, repo: params.repo, number: params.number },
        params.auth,
    );
    const headSha = pr.headSha || "unknown";

    if (!params.force) {
        const cached = getCachedReview(params.owner, params.repo, params.number, headSha);
        if (cached) {
            return { ...cached, fromCache: true, headSha };
        }
    }

    const result = await runPullRequestReview({
        owner: params.owner,
        repo: params.repo,
        number: params.number,
        auth: params.auth,
        includeDebug: params.includeDebug,
    });
    setCachedReview(params.owner, params.repo, params.number, headSha, result);
    return { ...result, headSha };
}
