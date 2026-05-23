import { app } from "./app.ts";

const port = Number(process.env.PORT) || 3000;

const server = Bun.serve({
    port,
    fetch: app.fetch,
});

console.log(`Server running at ${server.url}`);
