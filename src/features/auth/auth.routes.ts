import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { config, isOAuthConfigured } from "../../shared/config.ts";
import { buildAuthorizeUrl, exchangeCodeForToken } from "./auth.service.ts";

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

export const authApp = new Hono();

authApp.get("/github", (c) => {
    if (!isOAuthConfigured()) {
        return c.json(
            { error: "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.", status: 500 },
            500,
        );
    }

    const state = crypto.randomUUID();
    setCookie(c, OAUTH_STATE_COOKIE, state, cookieOptions(600));

    return c.redirect(buildAuthorizeUrl(state));
});

authApp.get("/github/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const savedState = getCookie(c, OAUTH_STATE_COOKIE);
    const oauthError = c.req.query("error");

    deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/" });

    if (oauthError) {
        const description = c.req.query("error_description");
        if (c.req.query("format") === "json") {
            return c.json(
                { error: description ?? oauthError, status: 400 },
                400,
            );
        }
        return c.redirect(redirectToFrontendWithError(oauthError, description));
    }

    if (!code || !state || !savedState || state !== savedState) {
        if (c.req.query("format") === "json") {
            return c.json({ error: "Invalid OAuth state", status: 400 }, 400);
        }
        return c.redirect(redirectToFrontendWithError("invalid_state", "Invalid OAuth state"));
    }

    try {
        const accessToken = await exchangeCodeForToken(code);

        if (c.req.query("format") === "json") {
            return c.json({ access_token: accessToken, token_type: "bearer" });
        }

        return c.redirect(redirectToFrontendWithToken(accessToken));
    } catch (err) {
        const rawStatus = (err as { status?: number }).status;
        const statusCode = rawStatus === 400 ? 400 : 500;
        const message = err instanceof Error ? err.message : "OAuth token exchange failed";

        if (c.req.query("format") === "json") {
            return c.json({ error: message, status: statusCode }, statusCode);
        }

        return c.redirect(redirectToFrontendWithError("token_exchange_failed", message));
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
