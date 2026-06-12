export type CodeChunk = {
    id: string;
    owner: string;
    repo: string;
    ref: string;
    path: string;
    chunkIndex: number;
    content: string;
    embedding: number[];
    language: string;
    symbolNames: string[];
    imports: string[];
    lineStart: number;
    lineEnd: number;
    fileSha: string;
    indexedAt: string;
    isTest: boolean;
    directory: string;
};

export type VectorSearchHit = {
    chunk: CodeChunk;
    vectorScore: number;
    keywordScore: number;
};

export type IndexMeta = {
    owner: string;
    repo: string;
    ref: string;
    treeSha: string;
    chunkCount: number;
    fileCount: number;
    status: "idle" | "indexing" | "ready" | "failed";
    error?: string;
    completedAt?: string;
    startedAt?: string;
};

export interface VectorStore {
    upsertChunks(chunks: CodeChunk[]): Promise<void>;
    deleteRepoIndex(owner: string, repo: string, ref: string): Promise<void>;
    search(params: {
        embedding: number[];
        owner: string;
        repo: string;
        ref: string;
        topK: number;
    }): Promise<VectorSearchHit[]>;
    listChunks(owner: string, repo: string, ref: string): Promise<CodeChunk[]>;
    hasIndex(owner: string, repo: string, ref: string): Promise<boolean>;
}
