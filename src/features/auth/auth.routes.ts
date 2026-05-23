import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { config, isOAuthConfigured } from "../../shared/config.ts";
import { buildAuthorizeUrl, exchangeCodeForToken } from "./auth.service.ts";

const OAUTH_STATE_COOKIE = "oauth_state";
const GITHUB_TOKEN_COOKIE = "github_token";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function cookieOptions(maxAge: number) {
    return {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: "Lax" as const,
        path: "/",
        maxAge,
    };
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
        return c.json(
            { error: c.req.query("error_description") ?? oauthError, status: 400 },
            400,
        );
    }

    if (!code || !state || !savedState || state !== savedState) {
        return c.json({ error: "Invalid OAuth state", status: 400 }, 400);
    }

    try {
        const accessToken = await exchangeCodeForToken(code);
        setCookie(c, GITHUB_TOKEN_COOKIE, accessToken, cookieOptions(COOKIE_MAX_AGE));
        return c.redirect("/");
    } catch (err) {
        const rawStatus = (err as { status?: number }).status;
        const statusCode = rawStatus === 400 ? 400 : 500;
        const message = err instanceof Error ? err.message : "OAuth token exchange failed";
        return c.json({ error: message, status: statusCode }, statusCode);
    }
});

authApp.get("/github/logout", (c) => {
    deleteCookie(c, GITHUB_TOKEN_COOKIE, { path: "/" });
    return c.json({ ok: true });
});

authApp.get("/github/status", (c) => {
    const hasCookie = Boolean(getCookie(c, GITHUB_TOKEN_COOKIE));
    const hasEnvToken = Boolean(config.githubToken);

    return c.json({
        authenticated: hasCookie || hasEnvToken,
        oauthConfigured: isOAuthConfigured(),
        method: hasCookie ? "oauth" : hasEnvToken ? "env" : null,
    });
});
