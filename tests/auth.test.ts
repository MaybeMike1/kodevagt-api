import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { app } from "../src/app.ts";

const originalFetch = global.fetch;

function installOAuthTokenMock() {
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
        if (url === "https://api.github.com/user") {
            return Promise.resolve(
                Response.json({
                    login: "octocat",
                    id: 1,
                    avatar_url: "https://github.com/octocat.png",
                }),
            );
        }
        return originalFetch(input, init);
    };

    global.fetch = Object.assign(mockFetch, {
        preconnect: originalFetch.preconnect,
    });
}

describe("GitHub OAuth", () => {
    beforeEach(() => {
        process.env.GITHUB_CLIENT_ID = "test-client-id";
        process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
        process.env.GITHUB_OAUTH_REDIRECT_URI = "http://localhost:3000/auth/github/callback";
        process.env.GITHUB_OAUTH_FRONTEND_REDIRECT_URI = "http://localhost:1420/auth/callback";
        process.env.GITHUB_OAUTH_DESKTOP_REDIRECT_URI = "kodevagt://auth/callback";
    });

    afterEach(() => {
        delete process.env.GITHUB_CLIENT_ID;
        delete process.env.GITHUB_CLIENT_SECRET;
        delete process.env.GITHUB_OAUTH_REDIRECT_URI;
        delete process.env.GITHUB_OAUTH_FRONTEND_REDIRECT_URI;
        delete process.env.GITHUB_OAUTH_DESKTOP_REDIRECT_URI;
        global.fetch = originalFetch;
    });

    test("GET /auth/github redirecter til GitHub authorize URL (web)", async () => {
        const res = await app.request("/auth/github", { redirect: "manual" });

        expect(res.status).toBe(302);
        const location = res.headers.get("location");
        expect(location).toStartWith("https://github.com/login/oauth/authorize");
        expect(location).toContain("client_id=test-client-id");
        expect(location).toContain("state=");
        expect(res.headers.get("set-cookie")).toContain("oauth_state=");
    });

    test("GET /auth/github?client=desktop bruger client state", async () => {
        const res = await app.request("/auth/github?client=desktop&state=desktop-state-123", {
            redirect: "manual",
        });

        expect(res.status).toBe(302);
        const location = res.headers.get("location")!;
        expect(location).toContain("state=desktop-state-123");
        expect(res.headers.get("set-cookie") ?? "").not.toContain("oauth_state");
    });

    test("GET /auth/github?client=desktop kræver state", async () => {
        const res = await app.request("/auth/github?client=desktop");
        expect(res.status).toBe(400);
    });

    test("desktop callback redirecter med one-time code (ikke access token)", async () => {
        installOAuthTokenMock();

        await app.request("/auth/github?client=desktop&state=desktop-state-123", { redirect: "manual" });

        const callbackRes = await app.request(
            "/auth/github/callback?code=github-code&state=desktop-state-123",
            { redirect: "manual" },
        );

        expect(callbackRes.status).toBe(302);
        const location = callbackRes.headers.get("location")!;
        expect(location).toStartWith("kodevagt://auth/callback");
        expect(location).toContain("code=");
        expect(location).toContain("state=desktop-state-123");
        expect(location).not.toContain("access_token");
        expect(location).not.toContain("oauth-access-token");
    });

    test("desktop callback bruger redirect_uri til loopback", async () => {
        installOAuthTokenMock();

        await app.request(
            "/auth/github?client=desktop&state=loopback-state&redirect_uri=http://127.0.0.1:3847/callback",
            { redirect: "manual" },
        );

        const callbackRes = await app.request(
            "/auth/github/callback?code=github-code&state=loopback-state",
            { redirect: "manual" },
        );

        expect(callbackRes.status).toBe(302);
        const location = callbackRes.headers.get("location")!;
        expect(location).toStartWith("http://127.0.0.1:3847/callback");
        expect(location).toContain("code=");
    });

    test("POST /auth/desktop/exchange returnerer token og user", async () => {
        installOAuthTokenMock();

        await app.request("/auth/github?client=desktop&state=exchange-state", { redirect: "manual" });
        const callbackRes = await app.request(
            "/auth/github/callback?code=github-code&state=exchange-state",
            { redirect: "manual" },
        );
        const location = new URL(callbackRes.headers.get("location")!);
        const oneTimeCode = location.searchParams.get("code")!;

        const exchangeRes = await app.request("/auth/desktop/exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: oneTimeCode }),
        });

        expect(exchangeRes.status).toBe(200);
        const body = (await exchangeRes.json()) as {
            accessToken: string;
            tokenType: string;
            user: { login: string };
        };
        expect(body.accessToken).toBe("oauth-access-token");
        expect(body.tokenType).toBe("bearer");
        expect(body.user.login).toBe("octocat");

        const secondExchange = await app.request("/auth/desktop/exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: oneTimeCode }),
        });
        expect(secondExchange.status).toBe(400);
    });

    test("GET /auth/github/callback?format=json returnerer token som JSON (web)", async () => {
        installOAuthTokenMock();

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

    test("GET /auth/github/callback afviser ugyldig state (web)", async () => {
        const res = await app.request("/auth/github/callback?code=test-code&state=wrong&format=json");
        expect(res.status).toBe(400);
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
