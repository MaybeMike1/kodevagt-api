import * as lancedb from "@lancedb/lancedb";
import { config } from "../../shared/config.ts";
import type { CodeChunk, VectorSearchHit, VectorStore } from "./vector.types.ts";

const TABLE_NAME = "code_chunks";

type LanceRow = {
    id: string;
    owner: string;
    repo: string;
    ref: string;
    path: string;
    chunkIndex: number;
    content: string;
    vector: number[];
    language: string;
    symbolNames: string;
    imports: string;
    lineStart: number;
    lineEnd: number;
    fileSha: string;
    indexedAt: string;
    isTest: boolean;
    directory: string;
};

function toRow(chunk: CodeChunk): LanceRow {
    return {
        id: chunk.id,
        owner: chunk.owner,
        repo: chunk.repo,
        ref: chunk.ref,
        path: chunk.path,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        vector: chunk.embedding,
        language: chunk.language,
        symbolNames: JSON.stringify(chunk.symbolNames),
        imports: JSON.stringify(chunk.imports),
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        fileSha: chunk.fileSha,
        indexedAt: chunk.indexedAt,
        isTest: chunk.isTest,
        directory: chunk.directory,
    };
}

function fromRow(row: LanceRow): CodeChunk {
    return {
        id: row.id,
        owner: row.owner,
        repo: row.repo,
        ref: row.ref,
        path: row.path,
        chunkIndex: row.chunkIndex,
        content: row.content,
        embedding: row.vector,
        language: row.language,
        symbolNames: JSON.parse(row.symbolNames || "[]") as string[],
        imports: JSON.parse(row.imports || "[]") as string[],
        lineStart: row.lineStart,
        lineEnd: row.lineEnd,
        fileSha: row.fileSha,
        indexedAt: row.indexedAt,
        isTest: row.isTest,
        directory: row.directory,
    };
}

export class LanceVectorStore implements VectorStore {
    private connection: lancedb.Connection | null = null;
    private table: lancedb.Table | null = null;

    private async getTable(): Promise<lancedb.Table> {
        if (this.table) return this.table;
        this.connection = await lancedb.connect(config.vectorDbPath);
        const names = await this.connection.tableNames();
        if (names.includes(TABLE_NAME)) {
            this.table = await this.connection.openTable(TABLE_NAME);
        } else {
            this.table = await this.connection.createTable(TABLE_NAME, [
                {
                    id: "__init__",
                    owner: "",
                    repo: "",
                    ref: "",
                    path: "",
                    chunkIndex: 0,
                    content: "",
                    vector: Array.from({ length: config.embeddingDimensions }, () => 0),
                    language: "",
                    symbolNames: "[]",
                    imports: "[]",
                    lineStart: 0,
                    lineEnd: 0,
                    fileSha: "",
                    indexedAt: new Date().toISOString(),
                    isTest: false,
                    directory: "",
                },
            ]);
            await this.table.delete('id = "__init__"');
        }
        return this.table;
    }

    async upsertChunks(chunks: CodeChunk[]): Promise<void> {
        if (chunks.length === 0) return;
        const { owner, repo, ref } = chunks[0]!;
        await this.deleteRepoIndex(owner, repo, ref);
        const table = await this.getTable();
        await table.add(chunks.map(toRow));
    }

    async deleteRepoIndex(owner: string, repo: string, ref: string): Promise<void> {
        const table = await this.getTable();
        const escapedOwner = owner.replace(/'/g, "''");
        const escapedRepo = repo.replace(/'/g, "''");
        const escapedRef = ref.replace(/'/g, "''");
        try {
            await table.delete(
                `owner = '${escapedOwner}' AND repo = '${escapedRepo}' AND ref = '${escapedRef}'`,
            );
        } catch {
            // No rows for this repo — safe to ignore
        }
    }

    async listChunks(owner: string, repo: string, ref: string): Promise<CodeChunk[]> {
        const table = await this.getTable();
        const escapedOwner = owner.replace(/'/g, "''");
        const escapedRepo = repo.replace(/'/g, "''");
        const escapedRef = ref.replace(/'/g, "''");
        const rows = await table
            .query()
            .where(
                `owner = '${escapedOwner}' AND repo = '${escapedRepo}' AND ref = '${escapedRef}'`,
            )
            .limit(100_000)
            .toArray();
        return (rows as LanceRow[]).map(fromRow);
    }

    async hasIndex(owner: string, repo: string, ref: string): Promise<boolean> {
        const table = await this.getTable();
        const escapedOwner = owner.replace(/'/g, "''");
        const escapedRepo = repo.replace(/'/g, "''");
        const escapedRef = ref.replace(/'/g, "''");
        const count = await table.countRows(
            `owner = '${escapedOwner}' AND repo = '${escapedRepo}' AND ref = '${escapedRef}'`,
        );
        return count > 0;
    }

    async search(params: {
        embedding: number[];
        owner: string;
        repo: string;
        ref: string;
        topK: number;
    }): Promise<VectorSearchHit[]> {
        const table = await this.getTable();
        const escapedOwner = params.owner.replace(/'/g, "''");
        const escapedRepo = params.repo.replace(/'/g, "''");
        const escapedRef = params.ref.replace(/'/g, "''");
        const rows = await table
            .vectorSearch(params.embedding)
            .where(
                `owner = '${escapedOwner}' AND repo = '${escapedRepo}' AND ref = '${escapedRef}'`,
            )
            .limit(params.topK)
            .toArray();
        return (rows as Array<LanceRow & { _distance?: number }>).map((row) => ({
            chunk: fromRow(row),
            vectorScore: row._distance !== undefined ? 1 / (1 + row._distance) : 1,
            keywordScore: 0,
        }));
    }
}
