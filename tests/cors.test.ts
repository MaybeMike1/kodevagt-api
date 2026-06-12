import { describe, test, expect } from "bun:test";
import { app } from "../src/app.ts";

describe("CORS", () => {
    test("svarer på preflight med tilladt origin", async () => {
        const res = await app.request("/github/repos", {
            method: "OPTIONS",
            headers: {
                Origin: "http://localhost:1420",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "Authorization",
            },
        });

        expect(res.status).toBe(204);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:1420");
        expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    });

    test("inkluderer CORS headers på GET svar", async () => {
        process.env.GITHUB_TOKEN = "test-token";

        const res = await app.request("/github/status", {
            headers: { Origin: "http://localhost:1420" },
        });

        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:1420");

        delete process.env.GITHUB_TOKEN;
    });
});
