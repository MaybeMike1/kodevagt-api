import type { GeneratorFinding } from "./review.types.ts";

const PLACEHOLDER_TITLES = new Set([
    "finding",
    "issue",
    "comment",
    "untitled",
    "note",
    "review",
]);

function truncate(text: string, max = 80): string {
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** Replace generic model titles with text derived from body or location. */
export function deriveFindingTitle(
    f: Pick<GeneratorFinding, "title" | "body" | "file" | "line">,
): string {
    const title = f.title.trim();
    if (title && !PLACEHOLDER_TITLES.has(title.toLowerCase())) {
        return title;
    }

    const body = f.body.trim();
    if (body.length > 0) {
        const sentence = body.match(/^[^.!?\n]+[.!?]?/)?.[0]?.trim();
        if (sentence && sentence.length >= 8) {
            return truncate(sentence);
        }
        const firstLine = body.split("\n")[0]?.trim();
        if (firstLine && firstLine.length >= 8) {
            return truncate(firstLine);
        }
    }

    if (f.file) {
        const base = f.file.split("/").pop() ?? f.file;
        return f.line !== undefined ? `${base}:${f.line}` : base;
    }

    return "Review note";
}

/** Default confidence when the model omits or zeroes the field. */
export function defaultFindingConfidence(
    f: Pick<GeneratorFinding, "file" | "line" | "body">,
): number {
    if (f.file && f.line !== undefined) return 0.68;
    if (f.file) return 0.6;
    if (f.body.trim().length >= 40) return 0.55;
    return 0.48;
}

export function resolveRawConfidence(
    raw: unknown,
    f: Pick<GeneratorFinding, "file" | "line" | "body">,
): number {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n <= 1) return n;
    return defaultFindingConfidence(f);
}
