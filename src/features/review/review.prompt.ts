import type { PullRequestCommit, PullRequestDetail, PullRequestFile } from "../github/github.types.ts";
import type { RetrievalSelected } from "../retrieval/retrieval.types.ts";
import type { ReviewContextStats } from "./review.fallback.ts";

export function buildGeneratorSystemPrompt(minFindings: number): string {
    return `You are an expert code reviewer. Respond with JSON only, no markdown fences.

Required JSON shape:
{
  "thoughtProcess": "string — step-by-step reasoning",
  "summary": "string — executive summary (2-4 sentences)",
  "findings": [
    {
      "id": "f1",
      "severity": "info|suggestion|warning|critical",
      "file": "repo-relative path when applicable",
      "line": 0,
      "title": "short title",
      "body": "actionable explanation",
      "confidence": 0.0
    }
  ]
}

Rules:
- Return ${minFindings} to ${Math.min(minFindings + 2, 8)} findings for this batch (quality over quantity).
- Every finding MUST have: non-empty "body" (at least 2 sentences, 40+ characters), a specific "title" (never the word "Finding"), and "file" when about one file.
- Do NOT emit placeholder findings with empty body or generic titles.
- Each finding must be distinct — never repeat the same issue, file, or line.
- Cover different files or concerns; one finding per unique problem.
- Review security, correctness, error handling, tests, API breaks, and maintainability.
- When an inline diff is provided, cite specific files/lines from that diff.
- When the diff says "patch too large or unavailable", still review using file path, stats, RAG context, and PR description — use lower confidence (0.3-0.5).`;
}

export function patchCharLimitForBatch(fileCount: number): number {
    if (fileCount <= 4) return 6000;
    if (fileCount <= 8) return 2500;
    return 1200;
}

export function buildGeneratorUserPrompt(params: {
    pr: PullRequestDetail;
    commits: PullRequestCommit[];
    files: PullRequestFile[];
    snippets: RetrievalSelected[];
    stats: ReviewContextStats;
    batchNote?: string;
}): string {
    const patchLimit = patchCharLimitForBatch(params.files.length);
    const commitBlock = params.commits
        .slice(0, 10)
        .map((c) => `- ${c.sha.slice(0, 7)}: ${c.message.split("\n")[0]}`)
        .join("\n");

    const fileBlocks = params.files
        .map((f) => {
            const patch =
                f.patch && f.patch.length > 0
                    ? f.patch.slice(0, patchLimit)
                    : "(patch too large or unavailable — use RAG context and file path)";
            return `### ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})\n\`\`\`diff\n${patch}\n\`\`\``;
        })
        .join("\n\n");

    const ragBlock = [...params.snippets]
        .sort((a, b) => b.rerankScore - a.rerankScore)
        .map(
            (s) =>
                `--- ${s.path}:L${s.lineStart}-L${s.lineEnd} (relevance=${s.rerankScore.toFixed(2)}) ---\n${s.content.slice(0, 2000)}`,
        )
        .join("\n\n");

    const batchHeader = params.batchNote ? `\n${params.batchNote}\n` : "";

    return `PR #${params.pr.number}: ${params.pr.title}
Base: ${params.pr.baseRef} ← Head: ${params.pr.headRef}
${batchHeader}This batch: ${params.stats.changedFiles} file(s), ${params.stats.filesWithPatch} with patch, ${params.stats.ragSnippetCount} RAG snippets

Description:
${params.pr.body ?? "(none)"}

Commits:
${commitBlock || "(none)"}

Changed files:
${fileBlocks || "(none)"}

Related repository context (RAG):
${ragBlock || "(none)"}

Produce ${Math.min(Math.max(params.stats.changedFiles, 1), 6)} distinct substantive findings for the files in this batch only — no duplicates across findings.`;
}

export function buildStrictRetryPrompt(baseUserPrompt: string, minFindings: number): string {
    return `${baseUserPrompt}

IMPORTANT: Your previous response had no findings. Return valid JSON with at least ${minFindings} findings — one per major changed file or concern.`;
}

export function buildVerifierSystemPrompt(): string {
    return `You validate code review findings against diff evidence. Respond with JSON only.
Schema:
{
  "validations": [
    {
      "findingId": "matches finding id",
      "verdict": "supported|partial|unsupported|hallucinated",
      "confidence": 0-1,
      "rationale": "brief, cite diff lines or lack of evidence"
    }
  ]
}
Rules:
- supported: claim is clearly backed by the patch or RAG snippet
- partial: partly true or missing context
- unsupported: no evidence in provided material
- hallucinated: cites non-existent file/line or invented issue`;
}

export function buildVerifierUserPrompt(params: {
    files: PullRequestFile[];
    findings: Array<{ id: string; title: string; body: string; file?: string; line?: number }>;
}): string {
    const patches = params.files
        .map((f) => `### ${f.filename}\n${(f.patch ?? "(no patch)").slice(0, 4000)}`)
        .join("\n\n");
    const findings = params.findings
        .map(
            (f) =>
                `- [${f.id}] ${f.title} (${f.file ?? "no file"}${f.line !== undefined ? `:${f.line}` : ""})\n  ${f.body}`,
        )
        .join("\n");
    return `Patches:\n${patches}\n\nFindings to validate:\n${findings}`;
}
