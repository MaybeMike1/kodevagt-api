import { routes } from "./routes/routes";

const server = Bun.serve({
    routes,
});

console.log(`Server running at ${server.url}`);