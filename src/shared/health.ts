import { ollamaHealth } from "../features/ai/ollama.client.ts";
import { getVectorStore } from "../features/vector/vector-store.ts";
import { config } from "./config.ts";

export async function getAppHealth(): Promise<{
    ok: boolean;
    version: string;
    ollama: { ok: boolean; models: string[] };
    vectorDb: { ok: boolean; backend: string };
    review: { asyncDefault: boolean; minConfidence: number };
}> {
    const ollama = await ollamaHealth();
    let vectorOk = false;
    try {
        await getVectorStore();
        vectorOk = true;
    } catch {
        vectorOk = false;
    }

    return {
        ok: ollama.ok && vectorOk,
        version: "0.0.1",
        ollama,
        vectorDb: { ok: vectorOk, backend: config.vectorStoreBackend },
        review: {
            asyncDefault: config.reviewAsyncDefault,
            minConfidence: config.reviewMinConfidence,
        },
    };
}
