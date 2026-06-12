import { config } from "../../shared/config.ts";
import type { OllamaChatMessage, OllamaChatResponse } from "./ai.types.ts";

export class OllamaError extends Error {
    constructor(
        message: string,
        readonly status?: number,
    ) {
        super(message);
        this.name = "OllamaError";
    }
}

export async function ollamaHealth(): Promise<{ ok: boolean; models: string[] }> {
    try {
        const res = await fetch(`${config.ollamaBaseUrl}/api/tags`);
        if (!res.ok) {
            return { ok: false, models: [] };
        }
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        return {
            ok: true,
            models: (data.models ?? []).map((m) => m.name),
        };
    } catch {
        return { ok: false, models: [] };
    }
}

function hasModel(models: string[], name: string): boolean {
    return models.some((m) => m === name || m.startsWith(`${name}:`));
}

export function assertOllamaReady(health: { ok: boolean; models: string[] }): void {
    if (!health.ok) {
        throw new OllamaError(
            `Ollama is not reachable at ${config.ollamaBaseUrl}. Start Ollama and run: ollama pull ${config.ollamaEmbedModel}`,
        );
    }
    if (!hasModel(health.models, config.ollamaEmbedModel)) {
        throw new OllamaError(
            `Embedding model "${config.ollamaEmbedModel}" is not installed. Run: ollama pull ${config.ollamaEmbedModel}`,
        );
    }
}

export function assertOllamaChatReady(health: { ok: boolean; models: string[] }): void {
    assertOllamaReady(health);
    if (!hasModel(health.models, config.ollamaChatModel)) {
        throw new OllamaError(
            `Chat model "${config.ollamaChatModel}" is not installed. Run: ollama pull ${config.ollamaChatModel}`,
        );
    }
    if (
        config.reviewVerifierEnabled &&
        !hasModel(health.models, config.ollamaVerifierModel)
    ) {
        throw new OllamaError(
            `Verifier model "${config.ollamaVerifierModel}" is not installed. Run: ollama pull ${config.ollamaVerifierModel}`,
        );
    }
}

async function embedBatch(texts: string[]): Promise<number[][] | null> {
    if (texts.length === 0) return [];

    const embedRes = await fetch(`${config.ollamaBaseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: config.ollamaEmbedModel,
            input: texts.length === 1 ? texts[0] : texts,
        }),
    });

    if (embedRes.ok) {
        const data = (await embedRes.json()) as {
            embeddings?: number[][];
            embedding?: number[];
        };
        if (data.embeddings?.length === texts.length) return data.embeddings;
        if (texts.length === 1 && data.embeddings?.[0]) return [data.embeddings[0]];
        if (texts.length === 1 && data.embedding) return [data.embedding];
    }

    return null;
}

async function embedOneLegacy(text: string): Promise<number[]> {
    const legacyRes = await fetch(`${config.ollamaBaseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: config.ollamaEmbedModel,
            prompt: text,
        }),
    });

    if (!legacyRes.ok) {
        const detail = await legacyRes.text().catch(() => legacyRes.statusText);
        throw new OllamaError(
            `Ollama embed failed (${legacyRes.status}): ${detail}. Is Ollama running? Try: ollama pull ${config.ollamaEmbedModel}`,
            legacyRes.status,
        );
    }

    const legacy = (await legacyRes.json()) as { embedding: number[] };
    return legacy.embedding;
}

export async function ollamaEmbed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const batch = await embedBatch(texts);
    if (batch) return batch;

    const results: number[][] = [];
    for (const text of texts) {
        results.push(await embedOneLegacy(text));
    }
    return results;
}

export async function ollamaChat(
    messages: OllamaChatMessage[],
    options?: {
        model?: string;
        format?: "json";
        options?: Record<string, number>;
    },
): Promise<string> {
    const res = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: options?.model ?? config.ollamaChatModel,
            messages,
            stream: false,
            format: options?.format,
            options: options?.options,
        }),
    });
    if (!res.ok) {
        throw new OllamaError(`Ollama chat failed: ${res.statusText}`, res.status);
    }
    const data = (await res.json()) as OllamaChatResponse;
    const content = data.message?.content?.trim() ?? "";
    if (!content) {
        throw new OllamaError(
            "Ollama returned an empty chat response. Retry or try without format:json.",
        );
    }
    return content;
}
