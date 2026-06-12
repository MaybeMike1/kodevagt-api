import type { PullRequestDetail, PullRequestFile } from "../github/github.types.ts";
import type { RetrievalQuery } from "./retrieval.types.ts";

const SYMBOL_PATTERNS = [
    /\b(?:function|async\s+function)\s+([a-zA-Z_$][\w$]*)/g,
    /\b(?:class|interface|type|enum)\s+([a-zA-Z_$][\w$]*)/g,
    /\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=/g,
    /\b([a-zA-Z_$][\w$]*)\s*\(/g,
    /\b(?:def|fn|pub\s+fn)\s+([a-zA-Z_$][\w$]*)/g,
];

export function extractSymbolsFromPatch(patch: string | null | undefined): string[] {
    if (!patch) return [];
    const symbols = new Set<string>();
    const skip = new Set(["if", "for", "while", "switch", "catch", "return", "new", "typeof"]);

    for (const line of patch.split("\n")) {
        if (!line.startsWith("+") && !line.startsWith("-")) continue;
        const content = line.slice(1);
        for (const pattern of SYMBOL_PATTERNS) {
            pattern.lastIndex = 0;
            for (const match of content.matchAll(pattern)) {
                const name = match[1];
                if (name && name.length > 1 && !skip.has(name)) symbols.add(name);
            }
        }
    }
    return [...symbols].slice(0, 20);
}

/** Parse unified-diff hunks and return new-file line numbers that were added or removed. */
export function extractChangedLineRangesFromPatch(
    patch: string | null | undefined,
): number[] {
    if (!patch) return [];
    const lines = new Set<number>();
    let newLine = 0;

    for (const raw of patch.split("\n")) {
        if (raw.startsWith("@@")) {
            const match = /\+(\d+)/.exec(raw);
            newLine = match ? Number(match[1]) : 0;
            continue;
        }
        if (raw.startsWith("+++") || raw.startsWith("---")) continue;

        if (raw.startsWith("+")) {
            lines.add(newLine);
            newLine += 1;
        } else if (raw.startsWith("-")) {
            lines.add(Math.max(1, newLine));
        } else if (raw.startsWith(" ") || raw === "") {
            newLine += 1;
        }
    }

    return [...lines].sort((a, b) => a - b).slice(0, 60);
}

export function buildFileQuery(file: PullRequestFile, pr: PullRequestDetail): RetrievalQuery {
    const patchPreview = (file.patch ?? "").slice(0, 500);
    const symbols = extractSymbolsFromPatch(file.patch);
    const changedLines = extractChangedLineRangesFromPatch(file.patch);
    const text = `path: ${file.filename}\ndiff: ${patchPreview}\nsymbols: ${symbols.join(" ")}\npr: ${pr.title}`;
    return {
        text,
        intent: `Review changes to ${file.filename} in PR: ${pr.title}`,
        file: file.filename,
        symbols,
        changedLines,
    };
}

export function buildGlobalQuery(pr: PullRequestDetail): RetrievalQuery {
    const body = (pr.body ?? "").slice(0, 500);
    return {
        text: `PR: ${pr.title}\n${body}`,
        intent: `Find related code for PR: ${pr.title}`,
        symbols: [],
    };
}
