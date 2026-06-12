import { describe, expect, test, beforeEach } from "bun:test";
import { getVectorStore, getVectorStoreSync, resetVectorStoreForTests } from "../src/features/vector/vector-store.ts";
import { MemoryVectorStore } from "../src/features/vector/memory-vector.store.ts";

describe("vector-store", () => {
    beforeEach(() => {
        process.env.VECTOR_STORE = "memory";
        resetVectorStoreForTests();
    });

    test("getVectorStore returns memory backend when configured", async () => {
        const store = await getVectorStore();
        expect(store).toBeInstanceOf(MemoryVectorStore);
    });

    test("getVectorStoreSync lazily creates memory store", () => {
        resetVectorStoreForTests();
        const a = getVectorStoreSync();
        const b = getVectorStoreSync();
        expect(a).toBe(b);
    });

    test("resetVectorStoreForTests accepts custom instance", async () => {
        const custom = new MemoryVectorStore();
        resetVectorStoreForTests(custom);
        expect(await getVectorStore()).toBe(custom);
    });
});
