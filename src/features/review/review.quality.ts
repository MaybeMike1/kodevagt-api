import type { GeneratorFinding, GeneratorOutput } from "./review.types.ts";

const PLACEHOLDER_TITLES = new Set(["finding", "issue", "comment", "untitled"]);

/** True when a finding has real review text, not a JSON placeholder. */
export function isSubstantiveFinding(
    f: Pick<GeneratorFinding, "title" | "body" | "file">,
): boolean {
    const body = f.body.trim();
    const title = f.title.trim().toLowerCase();

    if (body.length >= 24) return true;
    if (
        body.length >= 8 &&
        title.length >= 8 &&
        !PLACEHOLDER_TITLES.has(title)
    ) {
        return true;
    }
    return false;
}

export function filterSubstantiveFindings(
    findings: GeneratorFinding[],
): GeneratorFinding[] {
    return findings.filter(isSubstantiveFinding);
}

export function hasSubstantiveFindings(findings: GeneratorFinding[]): boolean {
    return filterSubstantiveFindings(findings).length > 0;
}

export function hasSubstantiveGeneratorOutput(output: GeneratorOutput): boolean {
    const hasSummary = output.summary.trim().length >= 40;
    const hasThought = output.thoughtProcess.trim().length >= 40;
    const substantive = filterSubstantiveFindings(output.findings);
    return substantive.length > 0 && (hasSummary || hasThought);
}
