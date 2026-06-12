import type { CodeChunk } from "../vector/vector.types.ts";

export type RetrievalQuery = {
    /** Embedding-bound text — what we send to the embedder. */
    text: string;
    /** Short human-readable intent (PR title, "review file X"). Used for the LLM reranker prompt. */
    intent?: string;
    /** Path the query is anchored on, if any (e.g. the changed file). */
    file?: string;
    /** Code symbols extracted from the diff/PR — used for keyword and symbol overlap scoring. */
    symbols?: string[];
    /** New-file line numbers touched by the diff — used to boost overlapping chunks. */
    changedLines?: number[];
};

export type RetrievalCandidate = {
    path: string;
    chunkIndex: number;
    vectorScore: number;
    keywordScore: number;
    fusedScore: number;
    rerankScore: number;
    llmScore?: number;
};

export type RetrievalSelected = {
    path: string;
    chunkIndex: number;
    lineStart: number;
    lineEnd: number;
    content: string;
    reason: string;
    rerankScore: number;
};

export type RetrievalLatency = {
    embed: number;
    search: number;
    rerank: number;
    llmRerank: number;
};

export type RetrievalDebugPayload = {
    queries: RetrievalQuery[];
    candidates: RetrievalCandidate[];
    selected: RetrievalSelected[];
    latencyMs: RetrievalLatency;
};

export type PackedContext = {
    snippets: RetrievalSelected[];
    debug?: RetrievalDebugPayload;
};

export type RetrievalHit = {
    chunk: CodeChunk;
    vectorScore: number;
    keywordScore: number;
    fusedScore: number;
    rerankScore: number;
    llmScore?: number;
};
