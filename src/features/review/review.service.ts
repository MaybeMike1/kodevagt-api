import { config } from "../../shared/config.ts";
import { assertOllamaChatReady, ollamaHealth } from "../ai/ollama.client.ts";
import {
    getPullRequest,
    listPullRequestCommits,
    listPullRequestFiles,
    type GitHubAuth,
} from "../github/github.client.ts";
import {
    getRepositoryIndexStatus,
    resolveDefaultRef,
} from "../indexing/indexing.service.ts";
import { retrieveForPullRequest } from "../retrieval/retrieval.service.ts";
import { getVectorStore } from "../vector/vector-store.ts";
import { buildReviewContextStats, ensureGeneratorOutput, prioritizeFilesByChange } from "./review.fallback.ts";
import { runGenerator } from "./review.generator.ts";
import { deduplicateFindings } from "./review.dedup.ts";
import {
    computeReviewMetrics,
    mergeFindingsWithValidations,
} from "./review.metrics.ts";
import { deriveFindingTitle } from "./review.titles.ts";
import { runVerifier } from "./review.verifier.ts";
import type { ReviewResult } from "./review.types.ts";

export async function runPullRequestReview(params: {
    owner: string;
    repo: string;
    number: number;
    auth: GitHubAuth;
    includeDebug?: boolean;
}): Promise<ReviewResult> {
    const start = performance.now();
    const health = await ollamaHealth();
    assertOllamaChatReady(health);

    const ref = await resolveDefaultRef(params.owner, params.repo, params.auth);
    const hasIndex = await (await getVectorStore()).hasIndex(
        params.owner,
        params.repo,
        ref,
    );
    if (!hasIndex) {
        const err = Object.assign(
            new Error(
                "Repository is not indexed. POST /index/repos/:owner/:repo first.",
            ),
            { status: 409 },
        );
        throw err;
    }

    const githubStart = performance.now();
    const [pr, { files }, { commits }] = await Promise.all([
        getPullRequest(
            { owner: params.owner, repo: params.repo, number: params.number },
            params.auth,
        ),
        listPullRequestFiles(
            { owner: params.owner, repo: params.repo, number: params.number },
            params.auth,
        ),
        listPullRequestCommits(
            { owner: params.owner, repo: params.repo, number: params.number },
            params.auth,
        ),
    ]);
    const githubMs = Math.round(performance.now() - githubStart);

    const prioritizedFiles = prioritizeFilesByChange(files);
    const maxFiles = config.reviewMaxFilesToReview;
    const reviewFiles =
        maxFiles > 0 && prioritizedFiles.length > maxFiles
            ? prioritizedFiles.slice(0, maxFiles)
            : prioritizedFiles;
    const filesTruncated =
        maxFiles > 0 && prioritizedFiles.length > reviewFiles.length;

    const retrievalStart = performance.now();
    const retrieval = await retrieveForPullRequest({
        owner: params.owner,
        repo: params.repo,
        ref,
        pr,
        files: reviewFiles,
        includeDebug: params.includeDebug ?? config.reviewDebug,
    });
    const retrievalMs = Math.round(performance.now() - retrievalStart);

    const generatorStart = performance.now();
    const generated = await runGenerator({
        pr,
        commits,
        files: reviewFiles,
        snippets: retrieval.snippets,
        filesTruncated,
        totalChangedFiles: files.length,
    });
    const generatorMs = Math.round(performance.now() - generatorStart);

    const reviewContext = buildReviewContextStats(reviewFiles, retrieval.snippets.length);
    const finalized = ensureGeneratorOutput(
        {
            summary: generated.summary,
            thoughtProcess: generated.thoughtProcess,
            findings: generated.findings,
        },
        reviewFiles,
        reviewContext,
        pr.changedFiles,
    );

    const uniqueFindings = deduplicateFindings(
        finalized.findings.map((f) => ({
            ...f,
            title: deriveFindingTitle(f),
        })),
    );

    const verifierStart = performance.now();
    const validations = config.reviewVerifierEnabled
        ? await runVerifier({ files: reviewFiles, findings: uniqueFindings })
        : { validations: [] };
    const verifierMs = Math.round(performance.now() - verifierStart);

    const findings = mergeFindingsWithValidations(
        uniqueFindings,
        validations.validations,
        reviewFiles,
    );
    const metrics = computeReviewMetrics(findings);

    const durationMs = Math.round(performance.now() - start);

    if (config.reviewTimingLog) {
        console.log("[review] timing", {
            owner: params.owner,
            repo: params.repo,
            number: params.number,
            changedFiles: files.length,
            reviewedFiles: reviewFiles.length,
            filesTruncated,
            githubMs,
            retrievalMs,
            generatorMs,
            verifierMs,
            totalMs: durationMs,
            retrieval: retrieval.debug?.latencyMs,
        });
    }

    if (
        !finalized.summary.trim() &&
        !finalized.thoughtProcess.trim() &&
        findings.length === 0
    ) {
        console.error("[review] empty result", {
            owner: params.owner,
            repo: params.repo,
            number: params.number,
            changedFiles: files.length,
            prChangedFiles: pr.changedFiles,
            ragSnippets: retrieval.snippets.length,
        });
    }

    return {
        reviewId: crypto.randomUUID(),
        summary: finalized.summary,
        thoughtProcess: finalized.thoughtProcess,
        findings,
        metrics,
        context: reviewContext,
        usedFallback: generated.usedFallback || finalized.usedFallback,
        model: config.ollamaChatModel,
        verifierModel: config.ollamaVerifierModel,
        indexedRef: ref,
        durationMs,
        retrievalDebug: retrieval.debug,
    };
}

export async function reviewHealth(): Promise<{
    ollama: { ok: boolean; models: string[] };
    vectorDb: { ok: boolean };
}> {
    const health = await ollamaHealth();
    return {
        ollama: health,
        vectorDb: { ok: true },
    };
}
