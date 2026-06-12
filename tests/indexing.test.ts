import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MOCK_EMBED = Array.from({ length: 768 }, (_, i) => (i % 10) * 0.01);

mock.module("../src/features/ai/ollama.client.ts", () => ({
    OllamaError: class OllamaError extends Error {},
    ollamaHealth: async () => ({ ok: true, models: ["nomic-embed-text"] }),
    assertOllamaReady: () => {},
    ollamaEmbed: async (texts: string[]) => texts.map(() => [...MOCK_EMBED]),
}));

import { app } from "../src/app.ts";
import {
    deleteIndexMeta,
    getIndexMeta,
    loadIndexMeta,
    persistIndexMeta,
    resetIndexMetaForTests,
    setIndexMeta,
} from "../src/features/indexing/index-meta.store.ts";
import {
    deleteRepositoryIndex,
    getRepositoryIndexStatus,
    indexRepository,
    resolveDefaultRef,
} from "../src/features/indexing/indexing.service.ts";
import { MemoryVectorStore } from "../src/features/vector/memory-vector.store.ts";
import { buildCodeChunks } from "../src/features/vector/chunker.ts";
import { resetVectorStoreForTests } from "../src/features/vector/vector-store.ts";
import { installGitHubFetchMock } from "./support/github-api-mock.ts";

const auth = { token: "test-token" };

async function waitForIndexStatus(
    owner: string,
    repo: string,
    want: "ready" | "failed",
    timeoutMs = 8000,
) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const res = await app.request(`/index/repos/${owner}/${repo}/status`, {
            headers: { Authorization: "Bearer test-token" },
        });
        const body = (await res.json()) as { status: string; error?: string };
        if (body.status === want) return body;
        if (body.status === "failed" && want !== "failed") {
            throw new Error(body.error ?? "index failed");
        }
        await Bun.sleep(50);
    }
    throw new Error(`Timed out waiting for index status ${want}`);
}

describe("Index routes", () => {
    let restoreFetch: () => void;
    let tempDir: string;

    beforeAll(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "kodevagt-index-"));
        process.env.GITHUB_TOKEN = "test-token";
        process.env.VECTOR_STORE = "memory";
        process.env.VECTOR_STORE_PATH = tempDir;
        restoreFetch = installGitHubFetchMock();
        resetVectorStoreForTests(new MemoryVectorStore());
        resetIndexMetaForTests();
    });

    afterEach(() => {
        resetIndexMetaForTests();
        resetVectorStoreForTests(new MemoryVectorStore());
    });

    afterAll(async () => {
        restoreFetch();
        delete process.env.GITHUB_TOKEN;
        delete process.env.VECTOR_STORE;
        delete process.env.VECTOR_STORE_PATH;
        await rm(tempDir, { recursive: true, force: true });
    });

    test("GET /index/health returns ollama status", async () => {
        const res = await app.request("/index/health", {
            headers: { Authorization: "Bearer test-token" },
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ollama: { ok: boolean } };
        expect(body.ollama.ok).toBe(true);
    });

    test("POST /index starts background indexing and completes", async () => {
        const start = await app.request("/index/repos/octocat/Hello-World", {
            method: "POST",
            headers: { Authorization: "Bearer test-token" },
        });
        expect(start.status).toBe(202);
        const started = (await start.json()) as { status: string; owner: string; repo: string };
        expect(started.status).toBe("indexing");

        const ready = await waitForIndexStatus("octocat", "Hello-World", "ready");
        expect(ready.status).toBe("ready");
        expect((ready as { chunkCount: number }).chunkCount).toBeGreaterThan(0);
    });

    test("POST /index returns existing job when already indexing", async () => {
        setIndexMeta({
            owner: "octocat",
            repo: "Hello-World",
            ref: "main",
            treeSha: "",
            chunkCount: 0,
            fileCount: 0,
            status: "indexing",
            startedAt: new Date().toISOString(),
        });

        const res = await app.request("/index/repos/octocat/Hello-World", {
            method: "POST",
            headers: { Authorization: "Bearer test-token" },
        });
        expect(res.status).toBe(202);
        const body = (await res.json()) as { status: string };
        expect(body.status).toBe("indexing");
    });

    test("GET /index/status returns idle when no index exists", async () => {
        const res = await app.request("/index/repos/octocat/Empty-Repo/status", {
            headers: { Authorization: "Bearer test-token" },
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { status: string; ref: string };
        expect(body.status).toBe("idle");
        expect(body.ref).toBe("main");
    });

    test("DELETE /index removes vector data and meta", async () => {
        const store = new MemoryVectorStore();
        const chunks = buildCodeChunks({
            owner: "octocat",
            repo: "Hello-World",
            ref: "main",
            path: "README.md",
            fileSha: "abc",
            content: "# Hello\n",
            embeddings: [MOCK_EMBED],
        });
        await store.upsertChunks(chunks);
        resetVectorStoreForTests(store);
        await persistIndexMeta({
            owner: "octocat",
            repo: "Hello-World",
            ref: "main",
            treeSha: "t",
            chunkCount: 1,
            fileCount: 1,
            status: "ready",
        });

        const del = await app.request("/index/repos/octocat/Hello-World", {
            method: "DELETE",
            headers: { Authorization: "Bearer test-token" },
        });
        expect(del.status).toBe(200);
        expect(await store.hasIndex("octocat", "Hello-World", "main")).toBe(false);
        expect(getIndexMeta("octocat", "Hello-World", "main")).toBeNull();
    });

    test("POST /index rejects Undefined repo slug", async () => {
        const res = await app.request("/index/repos/MaybeMike1/Undefined", {
            method: "POST",
            headers: { Authorization: "Bearer test-token" },
        });
        expect(res.status).toBe(400);
    });
});

describe("indexing.service", () => {
    let restoreFetch: () => void;

    beforeAll(() => {
        process.env.GITHUB_TOKEN = "test-token";
        process.env.VECTOR_STORE = "memory";
        restoreFetch = installGitHubFetchMock();
    });

    afterEach(() => {
        resetIndexMetaForTests();
        resetVectorStoreForTests(new MemoryVectorStore());
    });

    afterAll(() => {
        restoreFetch();
        delete process.env.GITHUB_TOKEN;
        delete process.env.VECTOR_STORE;
    });

    test("resolveDefaultRef uses explicit ref when provided", async () => {
        const ref = await resolveDefaultRef("octocat", "Hello-World", auth, "develop");
        expect(ref).toBe("develop");
    });

    test("resolveDefaultRef loads default branch from GitHub", async () => {
        const ref = await resolveDefaultRef("octocat", "Hello-World", auth);
        expect(ref).toBe("main");
    });

    test("getRepositoryIndexStatus rebuilds meta from vector store", async () => {
        const store = new MemoryVectorStore();
        await store.upsertChunks(
            buildCodeChunks({
                owner: "octocat",
                repo: "Hello-World",
                ref: "main",
                path: "src/a.ts",
                fileSha: "x",
                content: "export const a = 1;\n",
                embeddings: [MOCK_EMBED],
            }),
        );
        resetVectorStoreForTests(store);

        const status = await getRepositoryIndexStatus("octocat", "Hello-World", auth);
        expect(status.status).toBe("ready");
        expect(status.chunkCount).toBe(1);
        expect(getIndexMeta("octocat", "Hello-World", "main")?.status).toBe("ready");
    });

    test("deleteRepositoryIndex clears chunks without auth when ref given", async () => {
        const store = new MemoryVectorStore();
        await store.upsertChunks(
            buildCodeChunks({
                owner: "octocat",
                repo: "Hello-World",
                ref: "main",
                path: "f.ts",
                fileSha: "x",
                content: "x",
                embeddings: [MOCK_EMBED],
            }),
        );
        resetVectorStoreForTests(store);
        setIndexMeta({
            owner: "octocat",
            repo: "Hello-World",
            ref: "main",
            treeSha: "",
            chunkCount: 1,
            fileCount: 1,
            status: "ready",
        });

        await deleteRepositoryIndex("octocat", "Hello-World", "main");
        expect(await store.hasIndex("octocat", "Hello-World", "main")).toBe(false);
        expect(getIndexMeta("octocat", "Hello-World", "main")).toBeNull();
    });
});

describe("index-meta.store", () => {
    let tempDir: string;

    beforeAll(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "kodevagt-meta-"));
        process.env.VECTOR_STORE_PATH = tempDir;
    });

    afterEach(() => {
        resetIndexMetaForTests();
    });

    afterAll(async () => {
        delete process.env.VECTOR_STORE_PATH;
        await rm(tempDir, { recursive: true, force: true });
    });

    test("persistIndexMeta writes JSON and loadIndexMeta reads it back", async () => {
        const meta = {
            owner: "o",
            repo: "r",
            ref: "main",
            treeSha: "sha",
            chunkCount: 3,
            fileCount: 2,
            status: "ready" as const,
        };
        await persistIndexMeta(meta);
        resetIndexMetaForTests();

        const loaded = await loadIndexMeta("o", "r", "main");
        expect(loaded?.chunkCount).toBe(3);
        expect(loaded?.status).toBe("ready");
    });

    test("deleteIndexMeta removes in-memory entry", async () => {
        await persistIndexMeta({
            owner: "a",
            repo: "b",
            ref: "main",
            treeSha: "",
            chunkCount: 0,
            fileCount: 0,
            status: "idle",
        });
        deleteIndexMeta("a", "b", "main");
        expect(getIndexMeta("a", "b", "main")).toBeNull();
    });
});
