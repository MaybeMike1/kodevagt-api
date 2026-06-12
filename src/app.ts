import { Hono } from "hono";
import { cors } from "hono/cors";
import { authApp } from "./features/auth/auth.routes.ts";
import { githubApp } from "./features/github/github.routes.ts";
import { indexApp } from "./features/indexing/indexing.routes.ts";
import { reviewApp } from "./features/review/review.routes.ts";
import { config } from "./shared/config.ts";
import { requestLogMiddleware } from "./shared/request-log.middleware.ts";
import { getAppHealth } from "./shared/health.ts";

export const app = new Hono();

app.use("*", requestLogMiddleware);

app.use(
    "*",
    cors({
        origin: config.corsOrigins,
        allowHeaders: ["Authorization", "Content-Type"],
        allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
        exposeHeaders: ["Content-Length"],
        maxAge: 86400,
    }),
);

app.get("/", (c) => c.text("Kodevagt 0.0.1"));

app.get("/health", async (c) => {
    const health = await getAppHealth();
    return c.json(health, health.ok ? 200 : 503);
});
app.route("/auth", authApp);
app.route("/github", githubApp);
app.route("/index", indexApp);
app.route("/review", reviewApp);
