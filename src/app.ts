import { Hono } from "hono";
import { authApp } from "./features/auth/auth.routes.ts";
import { githubApp } from "./features/github/github.routes.ts";

export const app = new Hono();

app.get("/", (c) => c.text("Kodevagt 0.0.1"));
app.route("/auth", authApp);
app.route("/github", githubApp);
