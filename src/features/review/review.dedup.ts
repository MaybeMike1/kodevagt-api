import type { GeneratorFinding } from "./review.types.ts";

function normalizeText(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Stable key for duplicate detection across batches. */
export function findingDedupKey(f: GeneratorFinding): string {
    const file = (f.file ?? "").toLowerCase();
    const line = f.line ?? "";
    const body = normalizeText(f.body);
    const title = normalizeText(f.title);
    return `${file}|${line}|${body}|${title}`;
}

/** Keep the highest-confidence finding per dedup key; reassign sequential ids. */
export function deduplicateFindings(findings: GeneratorFinding[]): GeneratorFinding[] {
    const byKey = new Map<string, GeneratorFinding>();

    for (const finding of findings) {
        const key = findingDedupKey(finding);
        const existing = byKey.get(key);
        if (!existing || finding.confidence > existing.confidence) {
            byKey.set(key, finding);
        }
    }

    return [...byKey.values()].map((f, i) => ({
        ...f,
        id: `f${i + 1}`,
    }));
}
