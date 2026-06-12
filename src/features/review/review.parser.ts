export function parseJsonFromModel<T>(raw: string): T {
    const trimmed = raw.trim();
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = fenceMatch ? fenceMatch[1]!.trim() : trimmed;
    return JSON.parse(jsonText) as T;
}

type LooseFinding = {
    id?: string;
    severity?: string;
    file?: string;
    filename?: string;
    path?: string;
    line?: number;
    title?: string;
    name?: string;
    summary?: string;
    issue?: string;
    body?: string;
    description?: string;
    message?: string;
    detail?: string;
    comment?: string;
    confidence?: number;
};

function normalizeLooseFinding(f: LooseFinding, index: number): LooseFinding {
    return {
        id: f.id ?? `f${index + 1}`,
        severity: f.severity,
        file: f.file ?? f.filename ?? f.path,
        line: f.line,
        title: f.title ?? f.name ?? f.summary ?? f.issue,
        body: f.body ?? f.description ?? f.message ?? f.detail ?? f.comment,
        confidence: f.confidence,
    };
}

/** Normalize varied LLM JSON shapes into a findings array. */
export function extractFindingsFromParsed(parsed: unknown): LooseFinding[] {
    if (!parsed || typeof parsed !== "object") return [];

    const root = parsed as Record<string, unknown>;
    const candidates = [
        root.findings,
        root.issues,
        root.comments,
        (root.review as Record<string, unknown> | undefined)?.findings,
    ];

    for (const c of candidates) {
        if (Array.isArray(c)) {
            return (c as LooseFinding[]).map(normalizeLooseFinding);
        }
        if (c && typeof c === "object") {
            return Object.values(c as Record<string, LooseFinding>).map(
                normalizeLooseFinding,
            );
        }
    }
    return [];
}

export function extractSummaryFromParsed(parsed: unknown): string {
    if (!parsed || typeof parsed !== "object") return "";
    const root = parsed as Record<string, unknown>;
    const s = root.summary ?? root.overview ?? root.executiveSummary;
    return typeof s === "string" ? s : "";
}

export function extractThoughtProcessFromParsed(parsed: unknown): string {
    if (!parsed || typeof parsed !== "object") return "";
    const root = parsed as Record<string, unknown>;
    const t = root.thoughtProcess ?? root.reasoning ?? root.analysis;
    return typeof t === "string" ? t : "";
}
