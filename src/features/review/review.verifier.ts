import { config } from "../../shared/config.ts";
import { ollamaChat } from "../ai/ollama.client.ts";
import type { PullRequestFile } from "../github/github.types.ts";
import {
    buildVerifierSystemPrompt,
    buildVerifierUserPrompt,
} from "./review.prompt.ts";
import { parseJsonFromModel } from "./review.parser.ts";
import type { GeneratorFinding, VerifierOutput, VerifierVerdict } from "./review.types.ts";

const VALID_VERDICTS = new Set<VerifierVerdict>([
    "supported",
    "partial",
    "unsupported",
    "hallucinated",
]);

export async function runVerifier(params: {
    files: PullRequestFile[];
    findings: GeneratorFinding[];
}): Promise<VerifierOutput> {
    if (params.findings.length === 0) {
        return { validations: [] };
    }

    const content = await ollamaChat(
        [
            { role: "system", content: buildVerifierSystemPrompt() },
            {
                role: "user",
                content: buildVerifierUserPrompt({
                    files: params.files,
                    findings: params.findings,
                }),
            },
        ],
        { model: config.ollamaVerifierModel, format: "json" },
    );

    const parsed = parseJsonFromModel<VerifierOutput>(content);
    return {
        validations: (parsed.validations ?? []).map((v) => ({
            findingId: String(v.findingId),
            verdict: VALID_VERDICTS.has(v.verdict as VerifierVerdict)
                ? (v.verdict as VerifierVerdict)
                : "unsupported",
            confidence: Math.min(1, Math.max(0, Number(v.confidence) || 0.5)),
            rationale: String(v.rationale ?? ""),
        })),
    };
}
