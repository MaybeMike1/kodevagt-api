import { config } from "../../shared/config.ts";
import { ollamaEmbed } from "../ai/ollama.client.ts";
import type { PullRequestDetail, PullRequestFile } from "../github/github.types.ts";
import { getVectorStore } from "../vector/vector-store.ts";
import type { CodeChunk } from "../vector/vector.types.ts";
import { buildFileQuery, buildGlobalQuery } from "./retrieval.query.ts";
import { llmRerank } from "./retrieval.reranker.ts";
import {
    computeHeuristicBoost,
    computeRerankScore,
    getOrBuildIdfIndex,
    idfKeywordScore,
    mmrSelect,
    tokenize,
} from "./retrieval.scoring.ts";
import type {
    PackedContext,
    RetrievalHit,
    RetrievalLatency,
    RetrievalQuery,
    RetrievalSelected,
} from "./retrieval.types.ts";

const RRF_K = 60;
const CONTEXT_CHAR_BUDGET = 12_000;
const RERANK_MIN_CANDIDATES = 3;
const SEED_RERANK_SCORE = 1.5;
const FUSED_GAP_SKIP = 0.4;

type EmbedCache = Map<string, number[]>;

function reciprocalRankFusion(
    vectorRanked: Array<{ id: string; score: number }>,
    keywordRanked: Array<{ id: string; score: number }>,
): Map<string, number> {
    const fused = new Map<string, number>();
    const add = (list: Array<{ id: string; score: number }>, weight: number) => {
        list.forEach((item, rank) => {
            const rrf = weight / (RRF_K + rank + 1);
            fused.set(item.id, (fused.get(item.id) ?? 0) + rrf);
        });
    };
    add(vectorRanked, config.reviewHybridVectorWeight);
    add(keywordRanked, config.reviewHybridKeywordWeight);
    return fused;
}

function chunkKey(chunk: CodeChunk): string {
    return `${chunk.path}:${chunk.chunkIndex}`;
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    if (items.length === 0) return [];
    const results: R[] = new Array(items.length);
    let next = 0;
    const workers = Math.min(Math.max(1, concurrency), items.length);
    await Promise.all(
        Array.from({ length: workers }, async () => {
            while (true) {
                const i = next++;
                if (i >= items.length) break;
                results[i] = await fn(items[i]!, i);
            }
        }),
    );
    return results;
}

async function getQueryEmbedding(
    text: string,
    cache: EmbedCache,
): Promise<number[]> {
    const cached = cache.get(text);
    if (cached) return cached;
    const embeddings = await ollamaEmbed([text]);
    const embedding = embeddings[0];
    if (!embedding) {
        throw new Error("Embedding failed: ollamaEmbed returned no vector for query");
    }
    cache.set(text, embedding);
    return embedding;
}

function shouldSkipLlmRerank(pool: RetrievalHit[], query: RetrievalQuery): boolean {
    const minHeuristic = config.reviewRerankSkipHeuristicMin;
    if (minHeuristic <= 0 || pool.length < RERANK_MIN_CANDIDATES) {
        return pool.length < RERANK_MIN_CANDIDATES;
    }

    const top = pool[0]!;
    const heuristic = computeHeuristicBoost({
        chunkPath: top.chunk.path,
        chunkLineStart: top.chunk.lineStart,
        chunkLineEnd: top.chunk.lineEnd,
        chunkSymbols: top.chunk.symbolNames,
        querySymbols: query.symbols ?? [],
        changedPath: query.file,
        changedLines: query.changedLines,
    });
    if (heuristic >= minHeuristic) return true;

    const second = pool[1];
    if (second && top.fusedScore > 0) {
        const gap = (top.fusedScore - second.fusedScore) / top.fusedScore;
        if (gap >= FUSED_GAP_SKIP) return true;
    }
    return false;
}

function buildSeedHits(
    allChunks: CodeChunk[],
    filePath: string,
    changedLines: number[],
): RetrievalHit[] {
    if (changedLines.length === 0) return [];
    return allChunks
        .filter(
            (chunk) =>
                chunk.path === filePath &&
                changedLines.some(
                    (line) => line >= chunk.lineStart && line <= chunk.lineEnd,
                ),
        )
        .map((chunk) => ({
            chunk,
            vectorScore: 1,
            keywordScore: 1,
            fusedScore: 1,
            rerankScore: SEED_RERANK_SCORE,
        }));
}

function mergeCandidateHits(
    retrieved: RetrievalHit[],
    seeds: RetrievalHit[],
): RetrievalHit[] {
    const byId = new Map<string, RetrievalHit>();
    for (const hit of [...seeds, ...retrieved]) {
        const key = hit.chunk.id;
        const existing = byId.get(key);
        if (!existing || hit.rerankScore > existing.rerankScore) {
            byId.set(key, hit);
        }
    }
    return [...byId.values()].sort((a, b) => b.rerankScore - a.rerankScore);
}

function applyLlmRerankToPool(
    pool: RetrievalHit[],
    query: RetrievalQuery,
    llmScores: Map<number, number>,
): RetrievalHit[] {
    const maxFused = pool[0]?.fusedScore ?? 1;
    const querySymbols = query.symbols ?? [];
    const changedPath = query.file;
    const changedLines = query.changedLines;

    return pool.map((hit, idx) => {
        const heuristic = computeHeuristicBoost({
            chunkPath: hit.chunk.path,
            chunkLineStart: hit.chunk.lineStart,
            chunkLineEnd: hit.chunk.lineEnd,
            chunkSymbols: hit.chunk.symbolNames,
            querySymbols,
            changedPath,
            changedLines,
        });
        return {
            ...hit,
            llmScore: llmScores.get(idx),
            rerankScore: computeRerankScore({
                fusedScore: hit.fusedScore,
                maxFusedScore: maxFused,
                heuristic,
                llmScore: llmScores.get(idx),
                llmWeight: config.reviewRerankerWeight,
            }),
        };
    });
}

async function retrieveForQuery(params: {
    owner: string;
    repo: string;
    ref: string;
    query: RetrievalQuery;
    topK: number;
    allChunks: CodeChunk[];
    seedHits?: RetrievalHit[];
    embedCache: EmbedCache;
    llmRerankEnabled: boolean;
}): Promise<{ hits: RetrievalHit[]; latencyMs: RetrievalLatency }> {
    const embedStart = performance.now();
    const embedding = await getQueryEmbedding(params.query.text, params.embedCache);
    const embedMs = performance.now() - embedStart;

    const searchStart = performance.now();
    const store = await getVectorStore();
    const vectorHits = await store.search({
        embedding,
        owner: params.owner,
        repo: params.repo,
        ref: params.ref,
        topK: params.topK * 2,
    });
    const searchMs = performance.now() - searchStart;

    const allChunks = params.allChunks;
    const chunkById = new Map<string, CodeChunk>(allChunks.map((c) => [c.id, c]));
    const idfIndex = getOrBuildIdfIndex(
        params.owner,
        params.repo,
        params.ref,
        allChunks,
    );

    const queryTokens = tokenize(params.query.text);
    const keywordScored = allChunks
        .map((chunk) => ({
            id: chunk.id,
            score: idfKeywordScore(queryTokens, chunk.id, idfIndex),
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, params.topK * 2);
    const keywordById = new Map(keywordScored.map((k) => [k.id, k.score]));

    const vectorRanked = vectorHits.map((h) => ({
        id: h.chunk.id,
        score: h.vectorScore,
    }));

    const fusedScores = reciprocalRankFusion(vectorRanked, keywordScored);

    const candidates: RetrievalHit[] = [];
    for (const [id, fusedScore] of fusedScores) {
        const chunk = chunkById.get(id);
        if (!chunk) continue;
        const vHit = vectorHits.find((h) => h.chunk.id === id);
        candidates.push({
            chunk,
            vectorScore: vHit?.vectorScore ?? 0,
            keywordScore: keywordById.get(id) ?? 0,
            fusedScore,
            rerankScore: fusedScore,
        });
    }

    candidates.sort((a, b) => b.fusedScore - a.fusedScore);

    const querySymbols = params.query.symbols ?? [];
    const changedPath = params.query.file;
    const changedLines = params.query.changedLines;

    let llmScores = new Map<number, number>();
    const llmRerankStart = performance.now();
    const rerankPool = candidates.slice(0, config.reviewRerankerTopN);
    if (
        params.llmRerankEnabled &&
        config.reviewRerankerEnabled &&
        rerankPool.length >= RERANK_MIN_CANDIDATES &&
        !shouldSkipLlmRerank(rerankPool, params.query)
    ) {
        llmScores = await llmRerank(params.query, rerankPool);
    }
    const llmRerankMs = performance.now() - llmRerankStart;

    const maxFused = rerankPool[0]?.fusedScore ?? 1;
    const rerankStart = performance.now();
    const rerankedPool: RetrievalHit[] = rerankPool.map((hit, idx) => {
        const heuristic = computeHeuristicBoost({
            chunkPath: hit.chunk.path,
            chunkLineStart: hit.chunk.lineStart,
            chunkLineEnd: hit.chunk.lineEnd,
            chunkSymbols: hit.chunk.symbolNames,
            querySymbols,
            changedPath,
            changedLines,
        });
        return {
            ...hit,
            llmScore: llmScores.get(idx),
            rerankScore: computeRerankScore({
                fusedScore: hit.fusedScore,
                maxFusedScore: maxFused,
                heuristic,
                llmScore: llmScores.get(idx),
                llmWeight: config.reviewRerankerWeight,
            }),
        };
    });
    const reranked = mergeCandidateHits(
        [...rerankedPool, ...candidates.slice(rerankPool.length)],
        params.seedHits ?? [],
    ).slice(0, params.topK);
    const rerankMs = performance.now() - rerankStart;

    return {
        hits: reranked,
        latencyMs: { embed: embedMs, search: searchMs, rerank: rerankMs, llmRerank: llmRerankMs },
    };
}

async function applyPrLevelLlmRerank(
    hits: RetrievalHit[],
    query: RetrievalQuery,
): Promise<{ hits: RetrievalHit[]; llmRerankMs: number }> {
    const pool = hits.slice(0, config.reviewRerankerTopN);
    if (
        !config.reviewRerankerEnabled ||
        pool.length < RERANK_MIN_CANDIDATES ||
        shouldSkipLlmRerank(pool, query)
    ) {
        return { hits, llmRerankMs: 0 };
    }

    const llmRerankStart = performance.now();
    const llmScores = await llmRerank(query, pool);
    const llmRerankMs = performance.now() - llmRerankStart;
    const rerankedPool = applyLlmRerankToPool(pool, query, llmScores);

    const byId = new Map(hits.map((h) => [h.chunk.id, h]));
    for (const hit of rerankedPool) {
        byId.set(hit.chunk.id, hit);
    }
    const merged = [...byId.values()].sort((a, b) => b.rerankScore - a.rerankScore);
    return { hits: merged, llmRerankMs };
}

function packSnippets(
    hits: RetrievalHit[],
    changedPaths: Set<string>,
    maxSnippets: number,
): RetrievalSelected[] {
    const ordered = [...hits].sort((a, b) => {
        const aChanged = changedPaths.has(a.chunk.path) ? 1 : 0;
        const bChanged = changedPaths.has(b.chunk.path) ? 1 : 0;
        if (aChanged !== bChanged) return bChanged - aChanged;
        return b.rerankScore - a.rerankScore;
    });

    const diversified = mmrSelect(
        ordered.map((h) => ({
            id: chunkKey(h.chunk),
            score: h.rerankScore,
            content: h.chunk.content,
            hit: h,
        })),
        Math.min(maxSnippets * 2, ordered.length),
        config.reviewMmrLambda,
    );

    const selected: RetrievalSelected[] = [];
    let chars = 0;
    const perFile = new Map<string, number>();
    for (const item of diversified) {
        if (selected.length >= maxSnippets) break;
        const hit = item.hit;
        const isChangedFile = changedPaths.has(hit.chunk.path);
        const perFileLimit = isChangedFile ? 2 : 1;
        const count = perFile.get(hit.chunk.path) ?? 0;
        if (count >= perFileLimit) continue;
        const snippet = `[${hit.chunk.path}:L${hit.chunk.lineStart}-L${hit.chunk.lineEnd}]\n${hit.chunk.content}`;
        if (chars + snippet.length > CONTEXT_CHAR_BUDGET) break;
        const llmPart =
            hit.llmScore !== undefined ? ` llm=${hit.llmScore.toFixed(2)}` : "";
        selected.push({
            path: hit.chunk.path,
            chunkIndex: hit.chunk.chunkIndex,
            lineStart: hit.chunk.lineStart,
            lineEnd: hit.chunk.lineEnd,
            content: hit.chunk.content,
            rerankScore: hit.rerankScore,
            reason: `rerank=${hit.rerankScore.toFixed(3)} vector=${hit.vectorScore.toFixed(3)}${llmPart}`,
        });
        chars += snippet.length;
        perFile.set(hit.chunk.path, count + 1);
    }
    return selected;
}

export async function retrieveForPullRequest(params: {
    owner: string;
    repo: string;
    ref: string;
    pr: PullRequestDetail;
    files: PullRequestFile[];
    includeDebug?: boolean;
}): Promise<PackedContext> {
    const topK = config.reviewTopK;
    const maxSnippets = config.reviewMaxSnippets;
    const changedPaths = new Set(params.files.map((f) => f.filename));
    const perQueryLlmRerank =
        config.reviewRerankerEnabled && config.reviewRerankPerQuery;
    const embedCache: EmbedCache = new Map();

    const store = await getVectorStore();
    const allChunks = await store.listChunks(params.owner, params.repo, params.ref);

    const fileQueries = params.files.map((f) => buildFileQuery(f, params.pr));
    const allCandidates: RetrievalHit[] = [];
    const totalLatency: RetrievalLatency = { embed: 0, search: 0, rerank: 0, llmRerank: 0 };

    const fileResults = await mapWithConcurrency(
        fileQueries,
        config.reviewRetrievalConcurrency,
        async (query) => {
            const seeds = buildSeedHits(
                allChunks,
                query.file ?? "",
                query.changedLines ?? [],
            );
            return retrieveForQuery({
                owner: params.owner,
                repo: params.repo,
                ref: params.ref,
                query,
                topK,
                allChunks,
                seedHits: seeds,
                embedCache,
                llmRerankEnabled: perQueryLlmRerank,
            });
        },
    );

    for (const { hits, latencyMs } of fileResults) {
        totalLatency.embed += latencyMs.embed;
        totalLatency.search += latencyMs.search;
        totalLatency.rerank += latencyMs.rerank;
        totalLatency.llmRerank += latencyMs.llmRerank;
        allCandidates.push(...hits);
    }

    if (config.reviewGlobalQueryEnabled && params.files.length > 1) {
        const globalQuery = buildGlobalQuery(params.pr);
        const { hits, latencyMs } = await retrieveForQuery({
            owner: params.owner,
            repo: params.repo,
            ref: params.ref,
            query: globalQuery,
            topK: config.reviewGlobalQueryTopK,
            allChunks,
            embedCache,
            llmRerankEnabled: perQueryLlmRerank,
        });
        totalLatency.embed += latencyMs.embed;
        totalLatency.search += latencyMs.search;
        totalLatency.rerank += latencyMs.rerank;
        totalLatency.llmRerank += latencyMs.llmRerank;
        for (const hit of hits) {
            if (!changedPaths.has(hit.chunk.path)) {
                hit.rerankScore *= 0.35;
            }
            allCandidates.push(hit);
        }
    }

    const bestByChunk = new Map<string, RetrievalHit>();
    for (const hit of allCandidates) {
        const key = chunkKey(hit.chunk);
        const existing = bestByChunk.get(key);
        if (!existing || hit.rerankScore > existing.rerankScore) {
            bestByChunk.set(key, hit);
        }
    }

    let ranked = [...bestByChunk.values()].sort((a, b) => {
        const aChanged = changedPaths.has(a.chunk.path) ? 1 : 0;
        const bChanged = changedPaths.has(b.chunk.path) ? 1 : 0;
        if (aChanged !== bChanged) return bChanged - aChanged;
        return b.rerankScore - a.rerankScore;
    });

    if (config.reviewRerankerEnabled && !config.reviewRerankPerQuery) {
        const prQuery = buildGlobalQuery(params.pr);
        const prRerank = await applyPrLevelLlmRerank(ranked, prQuery);
        totalLatency.llmRerank += prRerank.llmRerankMs;
        ranked = prRerank.hits.sort((a, b) => {
            const aChanged = changedPaths.has(a.chunk.path) ? 1 : 0;
            const bChanged = changedPaths.has(b.chunk.path) ? 1 : 0;
            if (aChanged !== bChanged) return bChanged - aChanged;
            return b.rerankScore - a.rerankScore;
        });
    }

    const snippets = packSnippets(ranked, changedPaths, maxSnippets);

    const result: PackedContext = {
        snippets,
    };

    if (params.includeDebug ?? config.reviewDebug) {
        result.debug = {
            queries: [
                ...fileQueries,
                ...(config.reviewGlobalQueryEnabled && params.files.length > 1
                    ? [buildGlobalQuery(params.pr)]
                    : []),
            ],
            candidates: ranked.map((h) => ({
                path: h.chunk.path,
                chunkIndex: h.chunk.chunkIndex,
                vectorScore: h.vectorScore,
                keywordScore: h.keywordScore,
                fusedScore: h.fusedScore,
                rerankScore: h.rerankScore,
                llmScore: h.llmScore,
            })),
            selected: result.snippets,
            latencyMs: totalLatency,
        };
    }

    return result;
}
