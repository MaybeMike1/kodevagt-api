import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { config, isOAuthConfigured } from "../../shared/config.ts";
import { createDesktopCode, consumeDesktopCode } from "./desktop-code.store.ts";
import {
    registerDesktopFlow,
    isDesktopFlow,
    consumeDesktopFlow,
} from "./desktop-pending.store.ts";
import { buildAuthorizeUrl, exchangeCodeForToken, fetchGitHubUser } from "./auth.service.ts";

const OAUTH_STATE_COOKIE = "oauth_state";

function cookieOptions(maxAge: number) {
    return {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: "Lax" as const,
        path: "/",
        maxAge,
    };
}

function redirectToFrontendWithToken(accessToken: string): string {
    const base = config.githubOAuthFrontendRedirectUri.replace(/\/$/, "");
    const params = new URLSearchParams({
        access_token: accessToken,
        token_type: "bearer",
    });
    return `${base}#${params.toString()}`;
}

function redirectToFrontendWithError(error: string, description?: string): string {
    const url = new URL(config.githubOAuthFrontendRedirectUri);
    url.searchParams.set("error", error);
    if (description) url.searchParams.set("error_description", description);
    return url.toString();
}

function resolveDesktopRedirectUri(redirectUri?: string): string {
    return redirectUri ?? config.githubOAuthDesktopRedirectUri;
}

function redirectToDesktopWithCode(oneTimeCode: string, state: string, redirectUri?: string): string {
    const url = new URL(resolveDesktopRedirectUri(redirectUri));
    url.searchParams.set("code", oneTimeCode);
    url.searchParams.set("state", state);
    return url.toString();
}

function redirectToDesktopWithError(
    error: string,
    state: string,
    redirectUri?: string,
    description?: string,
): string {
    const url = new URL(resolveDesktopRedirectUri(redirectUri));
    url.searchParams.set("error", error);
    url.searchParams.set("state", state);
    if (description) url.searchParams.set("error_description", description);
    return url.toString();
}

function isAllowedDesktopRedirect(uri: string): boolean {
    try {
        const url = new URL(uri);
        if (url.protocol === "kodevagt:") return true;
        return url.protocol === "http:" && url.hostname === "127.0.0.1";
    } catch {
        return false;
    }
}

export const authApp = new Hono();

authApp.get("/github", (c) => {
    if (!isOAuthConfigured()) {
        return c.json(
            { error: "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.", status: 500 },
            500,
        );
    }

    const client = c.req.query("client");

    if (client === "desktop") {
        const state = c.req.query("state");
        if (!state) {
            return c.json({ error: "Missing required query parameter: state", status: 400 }, 400);
        }

        const redirectUri = c.req.query("redirect_uri");
        if (redirectUri && !isAllowedDesktopRedirect(redirectUri)) {
            return c.json({ error: "Invalid redirect_uri", status: 400 }, 400);
        }

        registerDesktopFlow(state, redirectUri);
        return c.redirect(buildAuthorizeUrl(state));
    }

    const state = crypto.randomUUID();
    setCookie(c, OAUTH_STATE_COOKIE, state, cookieOptions(600));

    return c.redirect(buildAuthorizeUrl(state));
});

authApp.get("/github/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const oauthError = c.req.query("error");
    const desktop = state ? isDesktopFlow(state) : false;

    if (!desktop) {
        deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/" });
    }

    const desktopFlow = desktop && state ? consumeDesktopFlow(state) : undefined;
    const desktopRedirect = desktopFlow?.redirectUri;

    if (oauthError) {
        const description = c.req.query("error_description");
        if (desktop && state) {
            return c.redirect(redirectToDesktopWithError(oauthError, state, desktopRedirect, description));
        }
        if (c.req.query("format") === "json") {
            return c.json({ error: description ?? oauthError, status: 400 }, 400);
        }
        return c.redirect(redirectToFrontendWithError(oauthError, description));
    }

    if (!code || !state) {
        if (desktop) {
            return c.redirect(
                redirectToDesktopWithError("invalid_request", state ?? "", desktopRedirect, "Missing code or state"),
            );
        }
        if (c.req.query("format") === "json") {
            return c.json({ error: "Invalid OAuth state", status: 400 }, 400);
        }
        return c.redirect(redirectToFrontendWithError("invalid_state", "Invalid OAuth state"));
    }

    if (desktop) {
        if (!desktopFlow) {
            return c.redirect(
                redirectToDesktopWithError("invalid_state", state, desktopRedirect, "Invalid or expired OAuth state"),
            );
        }
    } else {
        const savedState = getCookie(c, OAUTH_STATE_COOKIE);
        if (!savedState || state !== savedState) {
            if (c.req.query("format") === "json") {
                return c.json({ error: "Invalid OAuth state", status: 400 }, 400);
            }
            return c.redirect(redirectToFrontendWithError("invalid_state", "Invalid OAuth state"));
        }
    }

    try {
        const accessToken = await exchangeCodeForToken(code);

        if (desktop) {
            const oneTimeCode = createDesktopCode(accessToken, state);
            return c.redirect(redirectToDesktopWithCode(oneTimeCode, state, desktopRedirect));
        }

        if (c.req.query("format") === "json") {
            return c.json({ access_token: accessToken, token_type: "bearer" });
        }

        return c.redirect(redirectToFrontendWithToken(accessToken));
    } catch (err) {
        const rawStatus = (err as { status?: number }).status;
        const statusCode = rawStatus === 400 ? 400 : 500;
        const message = err instanceof Error ? err.message : "OAuth token exchange failed";

        if (desktop) {
            return c.redirect(redirectToDesktopWithError("token_exchange_failed", state, desktopRedirect, message));
        }

        if (c.req.query("format") === "json") {
            return c.json({ error: message, status: statusCode }, statusCode);
        }

        return c.redirect(redirectToFrontendWithError("token_exchange_failed", message));
    }
});

authApp.post("/desktop/exchange", async (c) => {
    const body = await c.req.json<{ code?: string }>().catch(() => ({}));
    const code = body.code;

    if (!code) {
        return c.json({ error: "Missing required field: code", status: 400 }, 400);
    }

    const payload = consumeDesktopCode(code);
    if (!payload) {
        return c.json({ error: "Invalid or expired code", status: 400 }, 400);
    }

    try {
        const user = await fetchGitHubUser(payload.githubToken);
        return c.json({
            accessToken: payload.githubToken,
            tokenType: "bearer" as const,
            user,
        });
    } catch (err) {
        const rawStatus = (err as { status?: number }).status;
        const statusCode = rawStatus === 400 ? 400 : 500;
        const message = err instanceof Error ? err.message : "Failed to complete desktop exchange";
        return c.json({ error: message, status: statusCode }, statusCode);
    }
});

authApp.get("/github/status", (c) => {
    const authorization = c.req.header("Authorization");
    const hasBearer = authorization?.startsWith("Bearer ") ?? false;
    const hasEnvToken = Boolean(config.githubToken);

    return c.json({
        authenticated: hasBearer || hasEnvToken,
        oauthConfigured: isOAuthConfigured(),
        method: hasBearer ? "bearer" : hasEnvToken ? "env" : null,
    });
});
