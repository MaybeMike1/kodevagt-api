export type OAuthTokenResponse = {
    access_token: string;
    token_type: string;
    scope?: string;
};

export type OAuthErrorResponse = {
    error?: string;
    error_description?: string;
};

export type GitHubUser = {
    login: string;
    id: number;
    avatarUrl: string;
};

export type DesktopExchangeResponse = {
    accessToken: string;
    tokenType: "bearer";
    user: GitHubUser;
};
