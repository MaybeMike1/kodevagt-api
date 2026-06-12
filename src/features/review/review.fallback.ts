import { config } from "../../shared/config.ts";
import type { PullRequestFile } from "../github/github.types.ts";
import { deduplicateFindings } from "./review.dedup.ts";
import { filterSubstantiveFindings } from "./review.quality.ts";
import { deriveFindingTitle } from "./review.titles.ts";
import type { GeneratorFinding, GeneratorOutput } from "./review.types.ts";

export type ReviewContextStats = {
    changedFiles: number;
    filesWithPatch: number;
    filesWithoutPatch: number;
    ragSnippetCount: number;
};

export function buildReviewContextStats(
    files: PullRequestFile[],
    snippetCount: number,
): ReviewContextStats {
    const filesWithPatch = files.filter((f) => f.patch && f.patch.length > 0).length;
    return {
        changedFiles: files.length,
        filesWithPatch,
        filesWithoutPatch: files.length - filesWithPatch,
        ragSnippetCount: snippetCount,
    };
}

export function buildFallbackFindings(
    files: PullRequestFile[],
    stats: ReviewContextStats,
): GeneratorFinding[] {
    if (files.length === 0) {
        return [
            {
                id: "f1",
                severity: "info",
                title: "No changed files in pull request",
                body: "This PR has no file changes to review, or GitHub returned an empty file list.",
                confidence: 0.9,
            },
        ];
    }

    const limit = Math.min(files.length, config.reviewMaxFindings);
    return files.slice(0, limit).map((file, i) => {
        const hasPatch = Boolean(file.patch && file.patch.length > 0);
        const hint = patchHint(file.patch);
        return {
            id: `f${i + 1}`,
            severity: hasPatch ? "suggestion" : "info",
            file: file.filename,
            title: hasPatch
                ? `Review ${file.filename} (+${file.additions}/-${file.deletions})`
                : `Review ${file.filename} (no inline diff)`,
            body: hasPatch
                ? `The local model did not analyze this file in depth. Open the diff for \`${file.filename}\` (${file.status}, +${file.additions}/-${file.deletions}).${hint ? ` Sample additions: ${hint}.` : ""}`
                : `GitHub omitted the inline patch for \`${file.filename}\`. Check the PR on GitHub; ${stats.ragSnippetCount} indexed context snippet(s) may still apply.`,
            confidence: 0.35,
        };
    });
}

function patchHint(patch: string | null | undefined): string | null {
    if (!patch) return null;
    const lines = patch
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
        .slice(0, 2)
        .map((l) => l.slice(1, 72).trim())
        .filter(Boolean);
    return lines.length > 0 ? lines.join("; ") : null;
}

export function prioritizeFilesByChange(
    files: PullRequestFile[],
): PullRequestFile[] {
    return [...files].sort((a, b) => b.changes - a.changes);
}

function buildDefaultSummary(params: {
    usedFallback: boolean;
    modelGaveSkeleton: boolean;
    githubFileMismatch: boolean;
    stats: ReviewContextStats;
    prChangedFiles?: number;
    fileCount: number;
}): string {
    if (params.usedFallback && params.modelGaveSkeleton) {
        return `The local model returned placeholder findings for this PR (${params.stats.changedFiles} files). Per-file review notes are listed below — re-run with a larger model for deeper analysis.`;
    }
    if (params.githubFileMismatch) {
        return `GitHub reports ${params.prChangedFiles} changed file(s), but the files API returned none — review used PR metadata and RAG only.`;
    }
    if (params.fileCount === 0) {
        return "No file changes were available to review.";
    }
    return `Reviewed ${params.stats.changedFiles} changed file(s) (${params.stats.filesWithPatch} with inline diffs, ${params.stats.filesWithoutPatch} without).`;
}

function buildDefaultThoughtProcess(params: {
    usedFallback: boolean;
    modelGaveSkeleton: boolean;
    githubFileMismatch: boolean;
}): string {
    if (params.usedFallback && params.modelGaveSkeleton) {
        return "The model filled the findings array with empty placeholders (common on large PRs or small local models). Batched review and per-file fallbacks were applied.";
    }
    if (params.githubFileMismatch) {
        return "Could not load per-file diffs from GitHub; fallback findings list expected changed paths from PR stats.";
    }
    return "Automated review completed; the model returned no detailed reasoning text.";
}

export function ensureGeneratorOutput(
    output: GeneratorOutput,
    files: PullRequestFile[],
    stats: ReviewContextStats,
    prChangedFiles?: number,
): GeneratorOutput & { usedFallback: boolean } {
    const githubFileMismatch =
        files.length === 0 && (prChangedFiles ?? 0) > 0;

    let findings = output.findings;
    let usedFallback = false;

    const substantive = filterSubstantiveFindings(findings).map((f) => ({
        ...f,
        title: deriveFindingTitle(f),
    }));
    if (substantive.length > 0) {
        findings = deduplicateFindings(substantive).slice(
            0,
            config.reviewMaxFindings,
        );
    } else if (files.length > 0) {
        findings = buildFallbackFindings(
            prioritizeFilesByChange(files),
            stats,
        );
        usedFallback = true;
    }

    const modelGaveSkeleton =
        output.findings.length > 0 && substantive.length === 0;

    const summary =
        output.summary.trim() || buildDefaultSummary({
            usedFallback,
            modelGaveSkeleton,
            githubFileMismatch,
            stats,
            prChangedFiles,
            fileCount: files.length,
        });

    const thoughtProcess =
        output.thoughtProcess.trim() ||
        buildDefaultThoughtProcess({ usedFallback, modelGaveSkeleton, githubFileMismatch });

    if (findings.length === 0) {
        if (files.length > 0) {
            findings = buildFallbackFindings(
                prioritizeFilesByChange(files),
                stats,
            );
            usedFallback = true;
        } else if (githubFileMismatch) {
            findings = [
                {
                    id: "f1",
                    severity: "warning",
                    title: "Could not load PR file list from GitHub",
                    body: `The pull request shows ${prChangedFiles} changed file(s), but GET /pulls/{n}/files returned an empty list. Check token scopes (repo) and retry. RAG snippets: ${stats.ragSnippetCount}.`,
                    confidence: 0.85,
                },
            ];
            usedFallback = true;
        } else if (files.length === 0) {
            findings = buildFallbackFindings(files, stats);
            usedFallback = true;
        }
    }

    return { summary, thoughtProcess, findings, usedFallback };
}
