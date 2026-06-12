import { getRepo, getTree, getFileContent, type GitHubAuth } from "../github/github.client.ts";
import { assertOllamaReady, ollamaEmbed, ollamaHealth } from "../ai/ollama.client.ts";
import { buildCodeChunks, chunkFileContent, embeddingInputForChunk } from "../vector/chunker.ts";
import { extractSymbolNames } from "../vector/chunker.enrich.ts";
import { shouldSkipPath } from "../vector/denylist.ts";
import { getVectorStore } from "../vector/vector-store.ts";
import type { IndexMeta } from "../vector/vector.types.ts";
import {
    deleteIndexMeta,
    getIndexMeta,
    loadIndexMeta,
    persistIndexMeta,
    setIndexMeta,
} from "./index-meta.store.ts";
import { config } from "../../shared/config.ts";

const EMBED_BATCH = 16;
const FILE_CONCURRENCY = 5;

export async function resolveDefaultRef(
    owner: string,
    repo: string,
    auth: GitHubAuth,
    ref?: string,
): Promise<string> {
    if (ref) return ref;
    const info = await getRepo({ owner, repo }, auth);
    return info.defaultBranch;
}

async function markIndexFailed(
    started: IndexMeta,
    error: string,
): Promise<void> {
    const failed: IndexMeta = {
        ...started,
        status: "failed",
        error,
        completedAt: new Date().toISOString(),
    };
    await persistIndexMeta(failed);
}

export async function indexRepository(
    owner: string,
    repo: string,
    auth: GitHubAuth,
    ref?: string,
): Promise<IndexMeta> {
    const branch = await resolveDefaultRef(owner, repo, auth, ref);
    const existing = (await loadIndexMeta(owner, repo, branch)) ?? getIndexMeta(owner, repo, branch);
    if (existing?.status === "indexing") {
        return existing;
    }

    const health = await ollamaHealth();
    try {
        assertOllamaReady(health);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const failed: IndexMeta = {
            owner,
            repo,
            ref: branch,
            treeSha: "",
            chunkCount: 0,
            fileCount: 0,
            status: "failed",
            error: message,
            completedAt: new Date().toISOString(),
        };
        await persistIndexMeta(failed);
        throw err;
    }

    const started: IndexMeta = {
        owner,
        repo,
        ref: branch,
        treeSha: "",
        chunkCount: 0,
        fileCount: 0,
        status: "indexing",
        startedAt: new Date().toISOString(),
    };
    await persistIndexMeta(started);

    void runIndexJob(owner, repo, branch, auth, started).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        void markIndexFailed(started, message);
    });

    return started;
}

async function runIndexJob(
    owner: string,
    repo: string,
    ref: string,
    auth: GitHubAuth,
    started: IndexMeta,
): Promise<void> {
    const tree = await getTree({ owner, repo, ref }, auth);
    const blobs = tree.files
        .filter((f) => f.type === "blob" && !shouldSkipPath(f.path, f.size))
        .slice(0, config.indexMaxFiles);

    const chunkArrays: Awaited<ReturnType<typeof buildCodeChunks>>[] = [];
    let fileCount = 0;
    let skippedFiles = 0;
    let lastError: string | null = null;

    for (let i = 0; i < blobs.length; i += FILE_CONCURRENCY) {
        const batch = blobs.slice(i, i + FILE_CONCURRENCY);
        await Promise.all(
            batch.map(async (blob) => {
                try {
                    const file = await getFileContent(
                        { owner, repo, path: blob.path, ref },
                        auth,
                    );
                    const rawChunks = chunkFileContent(blob.path, file.content);
                    if (rawChunks.length === 0) {
                        skippedFiles += 1;
                        return;
                    }

                    const symbols = extractSymbolNames(file.content);
                    const texts = rawChunks.map((c) =>
                        embeddingInputForChunk(blob.path, c.content, symbols),
                    );

                    const embeddings: number[][] = [];
                    for (let j = 0; j < texts.length; j += EMBED_BATCH) {
                        const batchTexts = texts.slice(j, j + EMBED_BATCH);
                        const batchEmbeds = await ollamaEmbed(batchTexts);
                        embeddings.push(...batchEmbeds);
                    }

                    const chunks = buildCodeChunks({
                        owner,
                        repo,
                        ref,
                        path: blob.path,
                        fileSha: blob.sha,
                        content: file.content,
                        embeddings,
                    });
                    chunkArrays.push(chunks);
                    fileCount += 1;

                    const meta: IndexMeta = {
                        owner,
                        repo,
                        ref,
                        treeSha: tree.sha,
                        chunkCount: chunkArrays.reduce((n, c) => n + c.length, 0),
                        fileCount,
                        status: "indexing",
                        startedAt: started.startedAt,
                    };
                    setIndexMeta(meta);
                } catch (err) {
                    skippedFiles += 1;
                    lastError = err instanceof Error ? err.message : String(err);
                }
            }),
        );
    }

    const flat = chunkArrays.flat();
    if (flat.length === 0) {
        const hint = lastError
            ? lastError
            : blobs.length === 0
              ? "No indexable text files found in repository tree."
              : `Could not index any of ${blobs.length} files. Check Ollama (${config.ollamaBaseUrl}) and GitHub token scopes.`;
        await markIndexFailed(started, hint);
        return;
    }

    const store = await getVectorStore();
    await store.upsertChunks(flat);

    const done: IndexMeta = {
        owner,
        repo,
        ref,
        treeSha: tree.sha,
        chunkCount: flat.length,
        fileCount,
        status: "ready",
        completedAt: new Date().toISOString(),
        startedAt: started.startedAt,
    };
    await persistIndexMeta(done);
}

export async function deleteRepositoryIndex(
    owner: string,
    repo: string,
    ref?: string,
    auth?: GitHubAuth,
): Promise<void> {
    const branch =
        ref ?? (auth ? await resolveDefaultRef(owner, repo, auth) : "main");
    await (await getVectorStore()).deleteRepoIndex(owner, repo, branch);
    deleteIndexMeta(owner, repo, branch);
}

export async function getRepositoryIndexStatus(
    owner: string,
    repo: string,
    auth: GitHubAuth,
    ref?: string,
): Promise<IndexMeta> {
    const branch = await resolveDefaultRef(owner, repo, auth, ref);
    const meta = (await loadIndexMeta(owner, repo, branch)) ?? getIndexMeta(owner, repo, branch);
    if (meta) return meta;

    const store = await getVectorStore();
    const has = await store.hasIndex(owner, repo, branch);
    if (has) {
        const chunks = await store.listChunks(owner, repo, branch);
        const ready: IndexMeta = {
            owner,
            repo,
            ref: branch,
            treeSha: "",
            chunkCount: chunks.length,
            fileCount: new Set(chunks.map((c) => c.path)).size,
            status: "ready",
        };
        setIndexMeta(ready);
        return ready;
    }
    return {
        owner,
        repo,
        ref: branch,
        treeSha: "",
        chunkCount: 0,
        fileCount: 0,
        status: "idle",
    };
}
