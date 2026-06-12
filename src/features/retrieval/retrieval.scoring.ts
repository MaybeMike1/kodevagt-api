import type { CodeChunk } from "../vector/vector.types.ts";

export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9_./-]+/)
        .filter((t) => t.length > 1);
}

export type IdfIndex = {
    idf: Map<string, number>;
    chunkTokens: Map<string, Set<string>>;
};

/** Build an IDF index over a chunk corpus. Tokens that appear in many chunks get lower weight. */
export function buildIdfIndex(chunks: CodeChunk[]): IdfIndex {
    const N = Math.max(1, chunks.length);
    const df = new Map<string, number>();
    const chunkTokens = new Map<string, Set<string>>();
    for (const chunk of chunks) {
        const tokens = new Set(
            tokenize(`${chunk.path} ${chunk.symbolNames.join(" ")} ${chunk.content}`),
        );
        chunkTokens.set(chunk.id, tokens);
        for (const t of tokens) df.set(t, (df.get(t) ?? 0) + 1);
    }
    const idf = new Map<string, number>();
    for (const [token, count] of df) {
        idf.set(token, Math.log(1 + N / (1 + count)));
    }
    return { idf, chunkTokens };
}

/** IDF-weighted keyword score: sum of IDFs for query tokens that appear in the chunk, normalized by total query IDF. */
export function idfKeywordScore(
    queryTokens: string[],
    chunkId: string,
    index: IdfIndex,
): number {
    const tokens = index.chunkTokens.get(chunkId);
    if (!tokens || queryTokens.length === 0) return 0;
    let matched = 0;
    let total = 0;
    const seen = new Set<string>();
    for (const qt of queryTokens) {
        if (seen.has(qt)) continue;
        seen.add(qt);
        const w = index.idf.get(qt) ?? 0;
        total += w;
        if (tokens.has(qt)) matched += w;
    }
    return total > 0 ? matched / total : 0;
}

/** Cheap Jaccard over a content shingle set — used by MMR to penalize near-duplicates. */
function shingleSet(content: string, size = 8): Set<string> {
    const tokens = tokenize(content);
    const shingles = new Set<string>();
    for (let i = 0; i + size <= tokens.length; i++) {
        shingles.add(tokens.slice(i, i + size).join(" "));
    }
    if (shingles.size === 0 && tokens.length > 0) shingles.add(tokens.join(" "));
    return shingles;
}

function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    const [small, big] = a.size < b.size ? [a, b] : [b, a];
    for (const x of small) if (big.has(x)) inter += 1;
    const union = a.size + b.size - inter;
    return union > 0 ? inter / union : 0;
}

/**
 * Maximal Marginal Relevance over already-ranked items.
 * Picks items in order, penalising those whose content overlaps strongly with already-picked items.
 * lambda=1 → pure relevance; lambda=0 → pure diversity. Default 0.7 favours relevance.
 */
export function mmrSelect<T extends { id: string; score: number; content: string }>(
    items: T[],
    limit: number,
    lambda: number,
): T[] {
    if (items.length <= 1 || lambda >= 0.999) return items.slice(0, limit);
    const remaining = [...items];
    const picked: T[] = [];
    const shingles = new Map<string, Set<string>>();
    const getShingle = (item: T) => {
        let s = shingles.get(item.id);
        if (!s) {
            s = shingleSet(item.content);
            shingles.set(item.id, s);
        }
        return s;
    };

    while (picked.length < limit && remaining.length > 0) {
        let bestIdx = 0;
        let bestScore = -Infinity;
        for (let i = 0; i < remaining.length; i++) {
            const cand = remaining[i]!;
            let maxSim = 0;
            const candShingle = getShingle(cand);
            for (const p of picked) {
                const sim = jaccard(candShingle, getShingle(p));
                if (sim > maxSim) maxSim = sim;
            }
            const mmr = lambda * cand.score - (1 - lambda) * maxSim;
            if (mmr > bestScore) {
                bestScore = mmr;
                bestIdx = i;
            }
        }
        picked.push(remaining.splice(bestIdx, 1)[0]!);
    }
    return picked;
}

const idfCache = new Map<string, { count: number; index: IdfIndex }>();

/** IDF index cache keyed by (owner,repo,ref). Invalidates when chunk count changes. */
export function getOrBuildIdfIndex(
    owner: string,
    repo: string,
    ref: string,
    chunks: CodeChunk[],
): IdfIndex {
    const key = `${owner}/${repo}/${ref}`;
    const cached = idfCache.get(key);
    if (cached && cached.count === chunks.length) return cached.index;
    const index = buildIdfIndex(chunks);
    idfCache.set(key, { count: chunks.length, index });
    return index;
}

export function clearIdfCacheForTests(): void {
    idfCache.clear();
}

/** Boost when a chunk's line range overlaps lines touched in the diff. */
export function lineOverlapBoost(
    chunkLineStart: number,
    chunkLineEnd: number,
    changedLines: number[],
): number {
    if (changedLines.length === 0) return 0;
    let overlap = 0;
    for (const line of changedLines) {
        if (line >= chunkLineStart && line <= chunkLineEnd) overlap += 1;
    }
    if (overlap === 0) return 0;
    const coverage = overlap / Math.min(changedLines.length, 12);
    return Math.min(0.45, coverage * 0.45);
}

export function pathBoost(changedPath: string | undefined, chunkPath: string): number {
    if (!changedPath) return 0;
    if (chunkPath === changedPath) return 0.55;
    const changedDir = changedPath.includes("/")
        ? changedPath.slice(0, changedPath.lastIndexOf("/"))
        : "";
    if (changedDir && chunkPath.startsWith(`${changedDir}/`)) return 0.2;
    return 0;
}

export function computeHeuristicBoost(params: {
    chunkPath: string;
    chunkLineStart: number;
    chunkLineEnd: number;
    chunkSymbols: string[];
    querySymbols: string[];
    changedPath?: string;
    changedLines?: number[];
}): number {
    const symbolOverlap = params.querySymbols.filter((s) =>
        params.chunkSymbols.includes(s),
    ).length;
    return (
        symbolOverlap * 0.12 +
        pathBoost(params.changedPath, params.chunkPath) +
        lineOverlapBoost(
            params.chunkLineStart,
            params.chunkLineEnd,
            params.changedLines ?? [],
        )
    );
}

/** Blend fused retrieval score with optional LLM rerank and heuristic boosts. */
export function computeRerankScore(params: {
    fusedScore: number;
    maxFusedScore: number;
    heuristic: number;
    llmScore?: number;
    llmWeight: number;
}): number {
    const fusedNorm =
        params.maxFusedScore > 0 ? params.fusedScore / params.maxFusedScore : 0;
    if (params.llmScore !== undefined) {
        const w = params.llmWeight;
        return w * params.llmScore + (1 - w) * fusedNorm + params.heuristic;
    }
    return fusedNorm + params.heuristic;
}
