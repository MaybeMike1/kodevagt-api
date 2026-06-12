import { describe, test, expect, mock } from "bun:test";
import { app } from "../src/app.ts";

mock.module("../src/features/ai/ollama.client.ts", () => ({
    ollamaHealth: async () => ({
        ok: true,
        models: ["nomic-embed-text"],
    }),
}));

describe("GET /", () => {
    test("returns Kodevagt version text", async () => {
        const response = await app.request("/");

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("Kodevagt 0.0.1");
    });
});

describe("GET /health", () => {
    test("returns unified health payload", async () => {
        process.env.VECTOR_STORE = "memory";
        const res = await app.request("/health");
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            ok: boolean;
            version: string;
            ollama: { ok: boolean };
            vectorDb: { ok: boolean; backend: string };
            review: { asyncDefault: boolean };
        };
        expect(body.version).toBe("0.0.1");
        expect(body.ollama.ok).toBe(true);
        expect(body.vectorDb.ok).toBe(true);
        delete process.env.VECTOR_STORE;
    });
});
