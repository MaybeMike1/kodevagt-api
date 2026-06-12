import { app } from "./app.ts";

const port = Number(process.env.PORT) || 3000;
/** Bun max is 255s — long enough for Ollama review on one PR. */
const idleTimeoutSec = Math.min(
    255,
    Math.max(10, Number(process.env.SERVER_IDLE_TIMEOUT_SEC ?? "255")),
);

const server = Bun.serve({
    port,
    fetch: app.fetch,
    idleTimeout: idleTimeoutSec,
});

console.log(`Server running at ${server.url}`);
