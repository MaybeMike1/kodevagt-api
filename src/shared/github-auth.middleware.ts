import { createMiddleware } from "hono/factory";
import { config } from "./config.ts";
import type { AppVariables } from "./hono-context.ts";

export const githubAuthMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const authorization = c.req.header("Authorization");
    const bearerToken = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined;

    const token = bearerToken ?? config.githubToken;

    if (!token) {
        return c.json(
            {
                error: "Not authenticated. Send Authorization: Bearer <token> from your client.",
                status: 401,
            },
            401,
        );
    }

    c.set("githubToken", token);
    await next();
});
