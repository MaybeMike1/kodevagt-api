import type { MiddlewareHandler } from "hono";
import { config } from "./config.ts";

export const requestLogMiddleware: MiddlewareHandler = async (c, next) => {
    if (!config.requestLog) {
        await next();
        return;
    }

    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;
    const origin = c.req.header("origin");
    const referer = c.req.header("referer");
    const hasAuth = Boolean(c.req.header("authorization"));

    await next();

    const durationMs = Date.now() - start;
    const status = c.res.status;
    const parts = [`[http] ${method} ${path} ${status} ${durationMs}ms`];

    if (origin) parts.push(`origin=${origin}`);
    else if (referer) parts.push(`referer=${referer}`);
    if (hasAuth) parts.push("auth=Bearer");

    console.log(parts.join(" "));
};
