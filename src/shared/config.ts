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
    get githubOAuthRedirectUri() {
        return process.env.GITHUB_OAUTH_REDIRECT_URI ?? "http://localhost:3000/auth/github/callback";
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
