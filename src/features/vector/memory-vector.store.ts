import type { CodeChunk, VectorSearchHit, VectorStore } from "./vector.types.ts";

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i]! * b[i]!;
        normA += a[i]! * a[i]!;
        normB += b[i]! * b[i]!;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class MemoryVectorStore implements VectorStore {
    private chunks: CodeChunk[] = [];

    async upsertChunks(newChunks: CodeChunk[]): Promise<void> {
        if (newChunks.length === 0) return;
        const { owner, repo, ref } = newChunks[0]!;
        this.chunks = this.chunks.filter(
            (c) => !(c.owner === owner && c.repo === repo && c.ref === ref),
        );
        this.chunks.push(...newChunks);
    }

    async deleteRepoIndex(owner: string, repo: string, ref: string): Promise<void> {
        this.chunks = this.chunks.filter(
            (c) => !(c.owner === owner && c.repo === repo && c.ref === ref),
        );
    }

    async listChunks(owner: string, repo: string, ref: string): Promise<CodeChunk[]> {
        return this.chunks.filter(
            (c) => c.owner === owner && c.repo === repo && c.ref === ref,
        );
    }

    async hasIndex(owner: string, repo: string, ref: string): Promise<boolean> {
        return (await this.listChunks(owner, repo, ref)).length > 0;
    }

    async search(params: {
        embedding: number[];
        owner: string;
        repo: string;
        ref: string;
        topK: number;
    }): Promise<VectorSearchHit[]> {
        const filtered = this.chunks.filter(
            (c) =>
                c.owner === params.owner &&
                c.repo === params.repo &&
                c.ref === params.ref,
        );
        const scored = filtered.map((chunk) => ({
            chunk,
            vectorScore: cosineSimilarity(params.embedding, chunk.embedding),
            keywordScore: 0,
        }));
        scored.sort((a, b) => b.vectorScore - a.vectorScore);
        return scored.slice(0, params.topK);
    }
}
