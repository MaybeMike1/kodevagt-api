import type { PullRequestCommit, PullRequestDetail, PullRequestFile } from "../github/github.types.ts";
import type { RetrievalSelected } from "../retrieval/retrieval.types.ts";
import type { ReviewContextStats } from "./review.fallback.ts";

export function buildGeneratorSystemPrompt(minFindings: number): string {
    const maxFindings = Math.min(minFindings + 2, 6);
    return `You are an expert code reviewer. Respond with JSON only, no markdown fences.

Required JSON shape:
{
  "thoughtProcess": "string — step-by-step reasoning",
  "summary": "string — executive summary (2-4 sentences)",
  "findings": [
    {
      "id": "f1",
      "severity": "info|suggestion|warning|critical",
      "file": "repo-relative path",
      "line": 123,
      "title": "short specific title",
      "body": "2+ sentences: what changed, why it matters, suggested fix",
      "confidence": 0.85
    }
  ]
}

Rules:
- Return ${Math.min(minFindings, 3)} to ${maxFindings} findings — prefer fewer strong findings over filler.
- Every finding MUST include "file" and a non-empty "body" (40+ chars). Never use title "Finding".
- Each finding must be distinct (different file or different issue).
- Quote or reference specific diff lines in the body when a patch is provided.

Confidence rubric (use honestly):
- 0.88–0.95: issue is on a specific added/removed line you can point to in the diff
- 0.78–0.87: file and hunk are clear but line number may be approximate
- 0.65–0.77: concern is plausible from file path + RAG context, patch truncated or missing
- below 0.65: do not emit — omit instead of guessing

Focus on: security, correctness, error handling, breaking API changes, missing tests, and maintainability.`;
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
    const findingCount = Math.min(Math.max(params.stats.changedFiles, 1), 4);

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

Produce ${findingCount} distinct findings for this batch. Each finding must cite a file from above and set confidence using the rubric.`;
}

export function buildStrictRetryPrompt(baseUserPrompt: string, minFindings: number): string {
    return `${baseUserPrompt}

IMPORTANT: Your previous response had no usable findings. Return valid JSON with ${Math.min(minFindings, 3)} findings.
Each must have file, body (2 sentences), title, and confidence ≥ 0.78 citing diff evidence.`;
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
- supported: claim matches visible added/removed lines or clear hunk context in the patch
- partial: file is in the PR and the concern is plausible from the diff or RAG, even if line is off by a few lines
- unsupported: no related change in the provided patches for that file
- hallucinated: cites a file not in the PR or invents code that does not appear in the diff
- Prefer partial over unsupported when the file changed and the issue type fits the diff (e.g. error handling, naming, logic).
- Score every finding; do not omit ids.`;
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
