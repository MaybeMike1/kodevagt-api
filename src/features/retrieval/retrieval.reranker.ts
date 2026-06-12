import { config } from "../../shared/config.ts";
import { ollamaChat } from "../ai/ollama.client.ts";
import type { RetrievalHit, RetrievalQuery } from "./retrieval.types.ts";

const CANDIDATE_CONTENT_CHARS = 480;
const SYSTEM_PROMPT = `You are a code retrieval reranker. Score how useful each candidate code snippet is for answering or reviewing the given query.

Return ONLY JSON in this exact shape:
{"scores":[{"id":"<id>","relevance":0.0}]}

Rules:
- relevance is between 0.0 (unrelated) and 1.0 (directly relevant).
- A snippet that defines or modifies a symbol the query mentions, or lives at the query's path, is highly relevant.
- Boilerplate, unrelated tests, or generated files should score low even if they share keywords.
- Score every candidate; do not omit ids.`;

function buildUserPrompt(query: RetrievalQuery, hits: RetrievalHit[]): string {
    const symbols = query.symbols && query.symbols.length > 0
        ? query.symbols.join(", ")
        : "(none)";
    const intent = query.intent ?? query.text.slice(0, 200);
    const candidateBlocks = hits.map((h, idx) => {
        const id = `c${idx}`;
        const symList = h.chunk.symbolNames.slice(0, 8).join(", ");
        const content = h.chunk.content.slice(0, CANDIDATE_CONTENT_CHARS);
        return `[${id}] ${h.chunk.path}:L${h.chunk.lineStart}-L${h.chunk.lineEnd} symbols=[${symList}]\n${content}`;
    }).join("\n---\n");

    return `Query intent: ${intent}
Anchor path: ${query.file ?? "(none)"}
Symbols of interest: ${symbols}

Candidates:
${candidateBlocks}`;
}

type RerankResponse = {
    scores?: Array<{ id?: unknown; relevance?: unknown }>;
};

function parseScores(raw: string, hitCount: number): Map<number, number> {
    const out = new Map<number, number>();
    let parsed: RerankResponse;
    try {
        parsed = JSON.parse(raw) as RerankResponse;
    } catch {
        return out;
    }
    if (!parsed?.scores || !Array.isArray(parsed.scores)) return out;
    for (const entry of parsed.scores) {
        if (typeof entry?.id !== "string") continue;
        const match = /^c(\d+)$/.exec(entry.id);
        if (!match) continue;
        const idx = Number(match[1]);
        if (!Number.isFinite(idx) || idx < 0 || idx >= hitCount) continue;
        const rel = Number(entry.relevance);
        if (!Number.isFinite(rel)) continue;
        out.set(idx, Math.max(0, Math.min(1, rel)));
    }
    return out;
}

/**
 * Cross-encoder–style reranker: sends the query + candidate snippets to a local LLM
 * and asks for per-candidate relevance scores. Returns a Map keyed by candidate index.
 * On any failure (Ollama down, malformed JSON, empty response) returns an empty map —
 * callers should fall back to the heuristic rerank score.
 */
export async function llmRerank(
    query: RetrievalQuery,
    hits: RetrievalHit[],
): Promise<Map<number, number>> {
    if (hits.length === 0) return new Map();
    try {
        const raw = await ollamaChat(
            [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: buildUserPrompt(query, hits) },
            ],
            {
                model: config.ollamaRerankerModel,
                format: "json",
                options: { temperature: 0 },
            },
        );
        return parseScores(raw, hits.length);
    } catch {
        return new Map();
    }
}
