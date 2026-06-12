import { config, isOAuthConfigured } from "../../shared/config.ts";
import type { GitHubUser, OAuthErrorResponse, OAuthTokenResponse } from "./auth.types.ts";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

export function buildAuthorizeUrl(state: string): string {
    if (!isOAuthConfigured()) {
        throw Object.assign(new Error("GitHub OAuth is not configured"), { status: 500 });
    }

    const params = new URLSearchParams({
        client_id: config.githubClientId!,
        redirect_uri: config.githubOAuthRedirectUri,
        scope: config.githubOAuthScopes,
        state,
    });

    return `${GITHUB_AUTHORIZE_URL}?${params}`;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
    if (!isOAuthConfigured()) {
        throw Object.assign(new Error("GitHub OAuth is not configured"), { status: 500 });
    }

    const response = await fetch(GITHUB_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({
            client_id: config.githubClientId,
            client_secret: config.githubClientSecret,
            code,
            redirect_uri: config.githubOAuthRedirectUri,
        }),
    });

    const data = (await response.json()) as OAuthTokenResponse & OAuthErrorResponse;

    if (!response.ok || data.error || !data.access_token) {
        throw Object.assign(
            new Error(data.error_description ?? data.error ?? "OAuth token exchange failed"),
            { status: 400 },
        );
    }

    return data.access_token;
}

export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
    const response = await fetch("https://api.github.com/user", {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });

    if (!response.ok) {
        throw Object.assign(new Error("Failed to fetch GitHub user"), { status: response.status });
    }

    const data = (await response.json()) as {
        login: string;
        id: number;
        avatar_url: string;
    };

    return {
        login: data.login,
        id: data.id,
        avatarUrl: data.avatar_url,
    };
}
