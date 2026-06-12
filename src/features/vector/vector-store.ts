import { config } from "../../shared/config.ts";
import { MemoryVectorStore } from "./memory-vector.store.ts";
import type { VectorStore } from "./vector.types.ts";

let instance: VectorStore | null = null;

async function createLanceStore(): Promise<VectorStore> {
    const { LanceVectorStore } = await import("./lancedb.store.ts");
    return new LanceVectorStore();
}

export async function getVectorStore(): Promise<VectorStore> {
    if (!instance) {
        instance =
            config.vectorStoreBackend === "memory"
                ? new MemoryVectorStore()
                : await createLanceStore();
    }
    return instance;
}

export function getVectorStoreSync(): VectorStore {
    if (!instance) {
        instance = new MemoryVectorStore();
    }
    return instance;
}

export function resetVectorStoreForTests(store?: VectorStore): void {
    instance = store ?? new MemoryVectorStore();
}
