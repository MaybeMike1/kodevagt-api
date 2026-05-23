import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { config } from "../../shared/config.ts";
import type { AppVariables } from "../../shared/hono-context.ts";

export const githubAuthMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const authorization = c.req.header("Authorization");
    const bearerToken = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined;

    const token = bearerToken ?? getCookie(c, "github_token") ?? config.githubToken;

    if (!token) {
        return c.json(
            {
                error: "Not authenticated. Sign in at /auth/github or set GITHUB_TOKEN.",
                status: 401,
            },
            401,
        );
    }

    c.set("githubToken", token);
    await next();
});
