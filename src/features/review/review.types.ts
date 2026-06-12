import type { RetrievalDebugPayload } from "../retrieval/retrieval.types.ts";

export type QualityTier = "strict" | "relaxed" | "best-effort" | "none";

export type ReviewSeverity = "info" | "suggestion" | "warning" | "critical";
export type VerifierVerdict = "supported" | "partial" | "unsupported" | "hallucinated";

export type GeneratorFinding = {
    id: string;
    severity: ReviewSeverity;
    file?: string;
    line?: number;
    title: string;
    body: string;
    confidence: number;
};

export type GeneratorOutput = {
    thoughtProcess: string;
    summary: string;
    findings: GeneratorFinding[];
};

export type FindingValidation = {
    findingId: string;
    verdict: VerifierVerdict;
    confidence: number;
    rationale: string;
};

export type VerifierOutput = {
    validations: FindingValidation[];
};

export type ReviewFinding = GeneratorFinding & {
    validation?: FindingValidation;
    accuracyScore: number;
    citationValid: boolean;
};

export type ReviewMetrics = {
    overallAccuracy: number;
    supportedRate: number;
    hallucinationRate: number;
    avgGeneratorConfidence: number;
    avgVerifierConfidence: number;
    citationAccuracy: number;
    findingCount: number;
};

export type ReviewContextStats = {
    changedFiles: number;
    filesWithPatch: number;
    filesWithoutPatch: number;
    ragSnippetCount: number;
};

export type ReviewResult = {
    reviewId: string;
    summary: string;
    thoughtProcess: string;
    findings: ReviewFinding[];
    metrics: ReviewMetrics;
    context: ReviewContextStats;
    /** True when findings were synthesized because the model returned none. */
    usedFallback?: boolean;
    qualityTier?: QualityTier;
    candidatesBeforeFilter?: number;
    headSha?: string;
    fromCache?: boolean;
    model: string;
    verifierModel: string;
    indexedRef: string;
    durationMs: number;
    retrievalDebug?: RetrievalDebugPayload;
};

export type ReviewJobResponse = {
    jobId: string;
    status: "pending" | "running" | "completed" | "failed";
    pollUrl: string;
    owner: string;
    repo: string;
    number: number;
    headSha?: string;
    createdAt: string;
    completedAt?: string;
    error?: string;
    result?: ReviewResult;
};
