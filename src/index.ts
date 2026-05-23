import { githubRoutes } from "./features/github/github.routes.ts";

const server = Bun.serve({
    routes: {
        "/": () => new Response("Kodevagt 0.0.1"),
        ...githubRoutes,
    },
});

console.log(`Server running at ${server.url}`);
