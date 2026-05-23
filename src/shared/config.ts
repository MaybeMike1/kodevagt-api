const isProduction = process.env.NODE_ENV === "production";

export const config = {
    get githubToken() {
        return process.env.GITHUB_TOKEN;
    },
    get githubClientId() {
        return process.env.GITHUB_CLIENT_ID;
    },
    get githubClientSecret() {
        return process.env.GITHUB_CLIENT_SECRET;
    },
    /** Backend callback — must match the GitHub OAuth app settings. */
    get githubOAuthRedirectUri() {
        return process.env.GITHUB_OAUTH_REDIRECT_URI ?? "http://localhost:3000/auth/github/callback";
    },
    /** Tauri / frontend URL to receive the token after OAuth (hash fragment). */
    get githubOAuthFrontendRedirectUri() {
        return process.env.GITHUB_OAUTH_FRONTEND_REDIRECT_URI ?? "http://localhost:1420/auth/callback";
    },
    get githubOAuthScopes() {
        return process.env.GITHUB_OAUTH_SCOPES ?? "repo";
    },
    get isProduction() {
        return isProduction;
    },
};

export function isOAuthConfigured(): boolean {
    return Boolean(config.githubClientId && config.githubClientSecret);
}
