export type OAuthTokenResponse = {
    access_token: string;
    token_type: string;
    scope?: string;
};

export type OAuthErrorResponse = {
    error?: string;
    error_description?: string;
};
