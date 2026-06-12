import type { PullRequestFile } from "../github/github.types.ts";
import type {
    FindingValidation,
    GeneratorFinding,
    QualityTier,
    ReviewFinding,
    ReviewMetrics,
    VerifierVerdict,
} from "./review.types.ts";

const VERDICT_WEIGHT: Record<VerifierVerdict, number> = {
    supported: 1,
    partial: 0.6,
    unsupported: 0.2,
    hallucinated: 0,
};

type HunkRange = { start: number; count: number };

function parseHunkRanges(patch: string): HunkRange[] {
    const ranges: HunkRange[] = [];
    for (const row of patch.split("\n")) {
        if (!row.startsWith("@@")) continue;
        const match = row.match(/\+(\d+)(?:,(\d+))?/);
        if (!match) continue;
        const start = Number.parseInt(match[1]!, 10);
        const count = match[2] ? Number.parseInt(match[2], 10) : 1;
        ranges.push({ start, count });
    }
    return ranges;
}

function lineInHunkRange(patch: string, line: number): boolean {
    return parseHunkRanges(patch).some(
        (r) => line >= r.start && line < r.start + r.count,
    );
}

function lineInPatch(patch: string, line: number): boolean {
    let currentNew = 0;
    for (const row of patch.split("\n")) {
        if (row.startsWith("@@")) {
            const match = row.match(/\+(\d+)/);
            currentNew = match ? Number.parseInt(match[1], 10) : 0;
            continue;
        }
        if (row.startsWith("+") && !row.startsWith("+++")) {
            if (currentNew === line) return true;
            currentNew += 1;
            continue;
        }
        if (row.startsWith("-") && !row.startsWith("---")) {
            continue;
        }
        if (row.startsWith(" ")) {
            if (currentNew === line) return true;
            currentNew += 1;
        }
    }
    return false;
}

function lineMatchesPatch(patch: string, line: number): boolean {
    return lineInPatch(patch, line) || lineInHunkRange(patch, line);
}

export function isCitationValid(
    finding: GeneratorFinding,
    files: PullRequestFile[],
): boolean {
    if (!finding.file) return false;
    const file = files.find((f) => f.filename === finding.file);
    if (!file) return false;
    if (finding.line === undefined) return true;
    if (!file.patch || file.patch.length === 0) return true;
    if (lineMatchesPatch(file.patch, finding.line)) return true;
    // File is in the PR; line may be approximate or outside a truncated patch.
    return true;
}

export function adjustFindingConfidence(
    finding: GeneratorFinding,
    citationValid: boolean,
    validation: FindingValidation | undefined,
): number {
    let confidence = finding.confidence;
    if (citationValid) {
        confidence = Math.min(1, confidence + 0.06);
    }
    if (validation?.verdict === "supported") {
        confidence = Math.min(1, Math.max(confidence, 0.85));
    } else if (validation?.verdict === "partial") {
        confidence = Math.min(1, Math.max(confidence, citationValid ? 0.78 : 0.62));
    } else if (validation?.verdict === "unsupported") {
        confidence = Math.min(confidence, 0.55);
    } else if (validation?.verdict === "hallucinated") {
        confidence = Math.min(confidence, 0.35);
    }
    return Math.min(1, Math.max(0, confidence));
}

export function computeAccuracyScore(
    finding: GeneratorFinding,
    validation: FindingValidation | undefined,
    citationValid: boolean,
): number {
    const generatorPart = 0.4 * finding.confidence;
    const verdictWeight = validation
        ? VERDICT_WEIGHT[validation.verdict]
        : citationValid
          ? 0.55
          : 0.45;
    const verifierPart = 0.5 * (validation?.confidence ?? 0.5) * verdictWeight;
    const citationPart = 0.1 * (citationValid ? 1 : 0);
    return Math.min(1, Math.max(0, generatorPart + verifierPart + citationPart));
}

function passesEvidenceGate(
    f: ReviewFinding,
    options: { requireSupported: boolean; verifierRan: boolean },
): boolean {
    if (f.validation?.verdict === "hallucinated") return false;
    if (!f.citationValid || !f.file) return false;
    if (!options.requireSupported) {
        return f.validation?.verdict !== "unsupported";
    }
    if (options.verifierRan) {
        return (
            f.validation?.verdict === "supported" ||
            f.validation?.verdict === "partial"
        );
    }
    return true;
}

export function selectFindingsForResponse(
    findings: ReviewFinding[],
    options: {
        targetConfidence: number;
        minConfidence: number;
        requireSupported: boolean;
        verifierRan: boolean;
        allowFallback: boolean;
        maxResults?: number;
    },
): { findings: ReviewFinding[]; tier: QualityTier } {
    const max = options.maxResults ?? findings.length;
    if (options.minConfidence <= 0 && options.targetConfidence <= 0) {
        return { findings: findings.slice(0, max), tier: "none" };
    }

    const notHallucinated = findings.filter((f) => f.validation?.verdict !== "hallucinated");

    if (options.targetConfidence > 0) {
        const strict = notHallucinated.filter(
            (f) =>
                f.confidence >= options.targetConfidence &&
                passesEvidenceGate(f, options),
        );
        if (strict.length > 0) {
            return { findings: strict.slice(0, max), tier: "strict" };
        }
    }

    if (options.minConfidence > 0) {
        const relaxed = notHallucinated.filter(
            (f) =>
                f.confidence >= options.minConfidence &&
                passesEvidenceGate(f, options),
        );
        if (relaxed.length > 0) {
            return { findings: relaxed.slice(0, max), tier: "relaxed" };
        }
    }

    if (options.allowFallback) {
        const bestEffort = [...notHallucinated]
            .filter((f) => f.citationValid && f.file && f.confidence >= 0.55)
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, Math.min(max, 5));
        if (bestEffort.length > 0) {
            return { findings: bestEffort, tier: "best-effort" };
        }
    }

    return { findings: [], tier: "none" };
}

/** @deprecated Use selectFindingsForResponse for tiered fallback. */
export function filterFindingsByQuality(
    findings: ReviewFinding[],
    options: {
        minConfidence: number;
        requireSupported: boolean;
        verifierRan: boolean;
    },
): ReviewFinding[] {
    if (options.minConfidence <= 0) return findings;

    return findings.filter((f) => {
        if (f.confidence < options.minConfidence) return false;
        if (!options.requireSupported) return true;
        if (options.verifierRan) {
            return f.validation?.verdict === "supported";
        }
        return f.citationValid && Boolean(f.file);
    });
}

export function mergeFindingsWithValidations(
    findings: GeneratorFinding[],
    validations: FindingValidation[],
    files: PullRequestFile[],
): ReviewFinding[] {
    const byId = new Map(validations.map((v) => [v.findingId, v]));
    return findings.map((f) => {
        const validation = byId.get(f.id);
        const citationValid = isCitationValid(f, files);
        const confidence = adjustFindingConfidence(f, citationValid, validation);
        return {
            ...f,
            confidence,
            validation,
            citationValid,
            accuracyScore: computeAccuracyScore(
                { ...f, confidence },
                validation,
                citationValid,
            ),
        };
    });
}

export function computeReviewMetrics(findings: ReviewFinding[]): ReviewMetrics {
    const count = findings.length;
    if (count === 0) {
        return {
            overallAccuracy: 0,
            supportedRate: 0,
            hallucinationRate: 0,
            avgGeneratorConfidence: 0,
            avgVerifierConfidence: 0,
            citationAccuracy: 0,
            findingCount: 0,
        };
    }

    const supported = findings.filter((f) => f.validation?.verdict === "supported").length;
    const hallucinated = findings.filter((f) => f.validation?.verdict === "hallucinated").length;
    const citationHits = findings.filter((f) => f.citationValid).length;

    return {
        overallAccuracy:
            findings.reduce((s, f) => s + f.accuracyScore, 0) / count,
        supportedRate: supported / count,
        hallucinationRate: hallucinated / count,
        avgGeneratorConfidence:
            findings.reduce((s, f) => s + f.confidence, 0) / count,
        avgVerifierConfidence:
            findings.reduce((s, f) => s + (f.validation?.confidence ?? 0), 0) / count,
        citationAccuracy: citationHits / count,
        findingCount: count,
    };
}
