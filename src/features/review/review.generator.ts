import { config } from "../../shared/config.ts";
import { OllamaError, ollamaChat } from "../ai/ollama.client.ts";
import type { PullRequestCommit, PullRequestDetail, PullRequestFile } from "../github/github.types.ts";
import type { RetrievalSelected } from "../retrieval/retrieval.types.ts";
import {
    buildFallbackFindings,
    buildReviewContextStats,
    ensureGeneratorOutput,
    prioritizeFilesByChange,
} from "./review.fallback.ts";
import {
    buildGeneratorSystemPrompt,
    buildGeneratorUserPrompt,
    buildStrictRetryPrompt,
} from "./review.prompt.ts";
import { deduplicateFindings } from "./review.dedup.ts";
import {
    extractFindingsFromParsed,
    extractSummaryFromParsed,
    extractThoughtProcessFromParsed,
    parseJsonFromModel,
} from "./review.parser.ts";
import { deriveFindingTitle, resolveRawConfidence } from "./review.titles.ts";
import {
    filterSubstantiveFindings,
    hasSubstantiveFindings,
} from "./review.quality.ts";
import type { GeneratorOutput, ReviewSeverity } from "./review.types.ts";

const VALID_SEVERITIES = new Set<ReviewSeverity>([
    "info",
    "suggestion",
    "warning",
    "critical",
]);

const CHAT_OPTIONS_BASE = {
    temperature: 0.2,
};

function chatOptions() {
    return {
        ...CHAT_OPTIONS_BASE,
        num_predict: config.reviewChatNumPredict,
    };
}

function normalizeLine(line: unknown): number | undefined {
    if (typeof line !== "number" || !Number.isFinite(line) || line <= 0) {
        return undefined;
    }
    return Math.trunc(line);
}

function normalizeGeneratorFinding(
    f: GeneratorOutput["findings"][number],
    index: number,
): GeneratorOutput["findings"][number] {
    const body = String(f.body ?? "");
    const base = {
        id: String(f.id ?? `f${index + 1}`),
        severity: VALID_SEVERITIES.has(f.severity as ReviewSeverity)
            ? (f.severity as ReviewSeverity)
            : "suggestion",
        file: f.file ? String(f.file) : undefined,
        line: normalizeLine(f.line),
        body,
    };
    return {
        ...base,
        title: deriveFindingTitle({
            ...base,
            title: String(f.title ?? "Finding"),
        }),
        confidence: Math.min(
            1,
            Math.max(0, resolveRawConfidence(f.confidence, base)),
        ),
    };
}

function normalizeGeneratorOutput(raw: GeneratorOutput): GeneratorOutput {
    return {
        thoughtProcess: String(raw.thoughtProcess ?? ""),
        summary: String(raw.summary ?? ""),
        findings: deduplicateFindings(
            (raw.findings ?? []).map((f, i) => normalizeGeneratorFinding(f, i)),
        ),
    };
}

function parseGeneratorContent(content: string): GeneratorOutput {
    const parsed = parseJsonFromModel<unknown>(content);
    const findings = extractFindingsFromParsed(parsed).map((f, i) => {
        const body = String(f.body ?? "");
        const base = {
            id: String(f.id ?? `f${i + 1}`),
            severity: (f.severity ?? "suggestion") as ReviewSeverity,
            file: f.file,
            line: normalizeLine(f.line),
            body,
        };
        return {
            ...base,
            title: deriveFindingTitle({
                ...base,
                title: String(f.title ?? "Finding"),
            }),
            confidence: resolveRawConfidence(f.confidence, base),
        };
    });
    return normalizeGeneratorOutput({
        thoughtProcess: extractThoughtProcessFromParsed(parsed),
        summary: extractSummaryFromParsed(parsed),
        findings,
    });
}

function isUnusableGeneratorOutput(output: GeneratorOutput): boolean {
    return (
        !output.summary.trim() &&
        !output.thoughtProcess.trim() &&
        !hasSubstantiveFindings(output.findings)
    );
}

async function callGenerator(
    systemPrompt: string,
    userPrompt: string,
    format?: "json",
): Promise<GeneratorOutput> {
    const content = await ollamaChat(
        [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ],
        { model: config.ollamaChatModel, format, options: chatOptions() },
    );
    return parseGeneratorContent(content);
}

async function tryParseGenerator(
    systemPrompt: string,
    userPrompt: string,
    format?: "json",
): Promise<GeneratorOutput | null> {
    try {
        const output = await callGenerator(systemPrompt, userPrompt, format);
        return isUnusableGeneratorOutput(output) ? null : output;
    } catch (err) {
        if (err instanceof OllamaError) return null;
        throw err;
    }
}

function snippetsForBatch(
    all: RetrievalSelected[],
    files: PullRequestFile[],
): RetrievalSelected[] {
    const names = new Set(files.map((f) => f.filename));
    const byRelevance = [...all].sort((a, b) => b.rerankScore - a.rerankScore);
    const matched = byRelevance.filter((s) => names.has(s.path));
    return (matched.length > 0 ? matched : byRelevance).slice(0, 12);
}

function mergeBatchOutputs(outputs: GeneratorOutput[]): GeneratorOutput {
    const merged: GeneratorOutput["findings"] = [];
    for (const o of outputs) {
        for (const f of filterSubstantiveFindings(o.findings)) {
            merged.push(f);
        }
    }
    const findings = deduplicateFindings(merged);

    const summaries = outputs
        .map((o) => o.summary.trim())
        .filter((s) => s.length >= 40);
    const thoughts = outputs
        .map((o) => o.thoughtProcess.trim())
        .filter((t) => t.length >= 40);

    return {
        summary: summaries.join(" "),
        thoughtProcess: thoughts.join("\n\n"),
        findings: findings.slice(0, config.reviewMaxFindings),
    };
}

async function invokeGeneratorForFiles(params: {
    pr: PullRequestDetail;
    commits: PullRequestCommit[];
    files: PullRequestFile[];
    snippets: RetrievalSelected[];
    batchNote?: string;
}): Promise<{ output: GeneratorOutput; usedFallback: boolean }> {
    const stats = buildReviewContextStats(params.files, params.snippets.length);
    const minFindings = Math.min(Math.max(stats.changedFiles, 1), 6);
    const systemPrompt = buildGeneratorSystemPrompt(minFindings);
    const userPrompt = buildGeneratorUserPrompt({ ...params, stats });
    const maxAttempts = config.reviewGeneratorMaxAttempts;

    let output: GeneratorOutput | null = await tryParseGenerator(
        systemPrompt,
        userPrompt,
        "json",
    );

    if (
        maxAttempts >= 2 &&
        (!output || !hasSubstantiveFindings(output.findings))
    ) {
        output =
            (await tryParseGenerator(
                systemPrompt,
                `${userPrompt}\n\nReturn valid JSON only.`,
                "json",
            )) ?? output;
    }

    if (
        maxAttempts >= 3 &&
        (!output || !hasSubstantiveFindings(output.findings)) &&
        stats.changedFiles > 0
    ) {
        output =
            (await tryParseGenerator(
                systemPrompt,
                buildStrictRetryPrompt(userPrompt, minFindings),
                "json",
            )) ?? output;
    }

    const base = output ?? {
        thoughtProcess: "",
        summary: "",
        findings: [],
    };

    if (!hasSubstantiveFindings(base.findings) && params.files.length > 0) {
        return {
            output: {
                summary: base.summary,
                thoughtProcess: base.thoughtProcess,
                findings: buildFallbackFindings(params.files, stats),
            },
            usedFallback: true,
        };
    }

    return {
        output: {
            ...base,
            findings: filterSubstantiveFindings(base.findings),
        },
        usedFallback: false,
    };
}

export async function runGenerator(params: {
    pr: PullRequestDetail;
    commits: PullRequestCommit[];
    files: PullRequestFile[];
    snippets: RetrievalSelected[];
    filesTruncated?: boolean;
    totalChangedFiles?: number;
}): Promise<GeneratorOutput & { usedFallback: boolean }> {
    const allFiles = prioritizeFilesByChange(params.files);
    const stats = buildReviewContextStats(allFiles, params.snippets.length);
    const batchSize = config.reviewBatchFileCount;

    let merged: GeneratorOutput;
    let batchUsedFallback = false;

    if (allFiles.length <= batchSize) {
        const single = await invokeGeneratorForFiles({
            ...params,
            files: allFiles,
            snippets: params.snippets,
        });
        merged = single.output;
        batchUsedFallback = single.usedFallback;
    } else {
        const batches: PullRequestFile[][] = [];
        for (let i = 0; i < allFiles.length; i += batchSize) {
            batches.push(allFiles.slice(i, i + batchSize));
        }

        const outputs: GeneratorOutput[] = [];
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i]!;
            const batchSnippets = snippetsForBatch(params.snippets, batch);
            const { output, usedFallback } = await invokeGeneratorForFiles({
                ...params,
                files: batch,
                snippets: batchSnippets,
                batchNote: `Batch ${i + 1}/${batches.length} of PR #${params.pr.number}`,
            });
            if (usedFallback) batchUsedFallback = true;
            outputs.push(output);
        }
        merged = mergeBatchOutputs(outputs);
        if (merged.findings.length === 0) {
            merged = {
                summary: "",
                thoughtProcess: "",
                findings: buildFallbackFindings(allFiles, stats),
            };
            batchUsedFallback = true;
        }
    }

    const ensured = ensureGeneratorOutput(
        merged,
        allFiles,
        stats,
        params.pr.changedFiles,
    );

    if (params.filesTruncated && params.totalChangedFiles) {
        const note = `Reviewed the ${allFiles.length} largest changed files (${params.totalChangedFiles} total in PR). Increase REVIEW_MAX_FILES to cover more.`;
        ensured.summary = ensured.summary.trim()
            ? `${ensured.summary} ${note}`
            : note;
    }

    return {
        ...ensured,
        usedFallback: ensured.usedFallback || batchUsedFallback,
    };
}
