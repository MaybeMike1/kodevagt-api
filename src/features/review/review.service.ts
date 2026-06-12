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
    selectFindingsForResponse,
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

    const mergedFindings = mergeFindingsWithValidations(
        uniqueFindings,
        validations.validations,
        reviewFiles,
    );

    const beforeFilter = mergedFindings.length;
    const { findings, tier } = selectFindingsForResponse(mergedFindings, {
        targetConfidence:
            config.reviewMinConfidence <= 0 ? 0 : config.reviewTargetConfidence,
        minConfidence: config.reviewMinConfidence,
        requireSupported: config.reviewRequireSupported,
        verifierRan: config.reviewVerifierEnabled,
        allowFallback: config.reviewQualityFallback,
        maxResults: config.reviewMaxFindings,
    });
    const metrics = computeReviewMetrics(findings);

    let summary = finalized.summary;
    if (tier === "relaxed") {
        summary = `${summary.trim()} Showing findings at ≥${Math.round(config.reviewMinConfidence * 100)}% confidence (strict ${Math.round(config.reviewTargetConfidence * 100)}% bar had no matches).`.trim();
    } else if (tier === "best-effort") {
        summary = `${summary.trim()} Only lower-confidence cited findings were available — consider a larger model or re-indexing for stronger reviews.`.trim();
    } else if (beforeFilter > findings.length && findings.length > 0) {
        const dropped = beforeFilter - findings.length;
        summary = `${summary.trim()} ${dropped} weaker finding(s) were omitted.`.trim();
    } else if (findings.length === 0 && beforeFilter > 0) {
        summary = `${summary.trim()} All ${beforeFilter} candidate finding(s) were filtered out — check REVIEW_MIN_CONFIDENCE or disable REVIEW_VERIFIER_ENABLED for debugging.`.trim();
    }

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
            qualityTier: tier,
            candidatesBeforeFilter: beforeFilter,
            findingsReturned: findings.length,
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
        summary,
        thoughtProcess: finalized.thoughtProcess,
        findings,
        metrics,
        context: reviewContext,
        usedFallback: generated.usedFallback || finalized.usedFallback,
        qualityTier: tier,
        candidatesBeforeFilter: beforeFilter,
        headSha: pr.headSha,
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
