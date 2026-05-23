import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { app } from "../src/app.ts";

const originalFetch = global.fetch;

describe("GitHub OAuth", () => {
    beforeEach(() => {
        process.env.GITHUB_CLIENT_ID = "test-client-id";
        process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
        process.env.GITHUB_OAUTH_REDIRECT_URI = "http://localhost:3000/auth/github/callback";
        process.env.GITHUB_OAUTH_FRONTEND_REDIRECT_URI = "http://localhost:1420/auth/callback";
    });

    afterEach(() => {
        delete process.env.GITHUB_CLIENT_ID;
        delete process.env.GITHUB_CLIENT_SECRET;
        delete process.env.GITHUB_OAUTH_REDIRECT_URI;
        delete process.env.GITHUB_OAUTH_FRONTEND_REDIRECT_URI;
        global.fetch = originalFetch;
    });

    test("GET /auth/github redirecter til GitHub authorize URL", async () => {
        const res = await app.request("/auth/github", { redirect: "manual" });

        expect(res.status).toBe(302);
        const location = res.headers.get("location");
        expect(location).toStartWith("https://github.com/login/oauth/authorize");
        expect(location).toContain("client_id=test-client-id");
        expect(location).toContain("state=");
        expect(res.headers.get("set-cookie")).toContain("oauth_state=");
    });

    test("GET /auth/github/callback redirecter token til frontend URL", async () => {
        const mockFetch = (
            input: Parameters<typeof fetch>[0],
            init?: Parameters<typeof fetch>[1],
        ) => {
            const url = input.toString();
            if (url === "https://github.com/login/oauth/access_token") {
                return Promise.resolve(
                    Response.json({ access_token: "oauth-access-token", token_type: "bearer" }),
                );
            }
            return originalFetch(input, init);
        };

        global.fetch = Object.assign(mockFetch, {
            preconnect: originalFetch.preconnect,
        });

        const loginRes = await app.request("/auth/github", { redirect: "manual" });
        const state = new URL(loginRes.headers.get("location")!).searchParams.get("state");

        const callbackRes = await app.request(
            `/auth/github/callback?code=test-code&state=${state}`,
            { headers: { Cookie: loginRes.headers.get("set-cookie") ?? "" }, redirect: "manual" },
        );

        expect(callbackRes.status).toBe(302);
        const location = callbackRes.headers.get("location")!;
        expect(location).toStartWith("http://localhost:1420/auth/callback#");
        expect(location).toContain("access_token=oauth-access-token");
        expect(location).toContain("token_type=bearer");
        expect(callbackRes.headers.get("set-cookie")).not.toContain("github_token");
    });

    test("GET /auth/github/callback?format=json returnerer token som JSON", async () => {
        global.fetch = Object.assign(
            (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
                if (input.toString() === "https://github.com/login/oauth/access_token") {
                    return Promise.resolve(
                        Response.json({ access_token: "oauth-access-token", token_type: "bearer" }),
                    );
                }
                return originalFetch(input, init);
            },
            { preconnect: originalFetch.preconnect },
        );

        const loginRes = await app.request("/auth/github", { redirect: "manual" });
        const state = new URL(loginRes.headers.get("location")!).searchParams.get("state");

        const callbackRes = await app.request(
            `/auth/github/callback?code=test-code&state=${state}&format=json`,
            { headers: { Cookie: loginRes.headers.get("set-cookie") ?? "" } },
        );

        expect(callbackRes.status).toBe(200);
        const body = (await callbackRes.json()) as { access_token: string; token_type: string };
        expect(body.access_token).toBe("oauth-access-token");
        expect(body.token_type).toBe("bearer");
    });

    test("GET /auth/github/callback afviser ugyldig state", async () => {
        const res = await app.request("/auth/github/callback?code=test-code&state=wrong&format=json");

        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe("Invalid OAuth state");
    });

    test("GET /auth/github/status rapporterer oauth konfiguration", async () => {
        const res = await app.request("/auth/github/status");
        const body = (await res.json()) as {
            authenticated: boolean;
            oauthConfigured: boolean;
            method: string | null;
        };

        expect(res.status).toBe(200);
        expect(body.oauthConfigured).toBe(true);
        expect(body.authenticated).toBe(false);
        expect(body.method).toBeNull();
    });

    test("GET /auth/github returnerer 500 når OAuth ikke er konfigureret", async () => {
        delete process.env.GITHUB_CLIENT_ID;
        delete process.env.GITHUB_CLIENT_SECRET;

        const res = await app.request("/auth/github");
        expect(res.status).toBe(500);
    });
});
