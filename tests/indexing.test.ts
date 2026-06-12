import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

const MOCK_EMBED = Array.from({ length: 768 }, (_, i) => (i % 10) * 0.01);

mock.module("../src/features/ai/ollama.client.ts", () => ({
    OllamaError: class OllamaError extends Error {},
    ollamaHealth: async () => ({ ok: true, models: ["nomic-embed-text"] }),
    assertOllamaReady: () => {},
    ollamaEmbed: async (texts: string[]) => texts.map(() => [...MOCK_EMBED]),
    ollamaChat: async () => "{}",
}));

import { app } from "../src/app.ts";
import { installGitHubFetchMock } from "./support/github-api-mock.ts";

describe("Index routes", () => {
    let restoreFetch: () => void;

    beforeAll(() => {
        process.env.GITHUB_TOKEN = "test-token";
        process.env.VECTOR_STORE = "memory";
        restoreFetch = installGitHubFetchMock();
    });

    afterAll(() => {
        restoreFetch();
        delete process.env.GITHUB_TOKEN;
        delete process.env.VECTOR_STORE;
    });

    test("GET /index/health returns ollama status", async () => {
        const res = await app.request("/index/health", {
            headers: { Authorization: "Bearer test-token" },
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ollama: { ok: boolean } };
        expect(body.ollama.ok).toBe(true);
    });
});
