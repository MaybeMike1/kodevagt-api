import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { githubRoutes } from "../src/features/github/github.routes.ts";

const routes = {
    "/": () => new Response("Kodevagt 0.0.1"),
    ...githubRoutes,
};

describe("GET /", () => {
    let server: ReturnType<typeof Bun.serve>;

    beforeAll(() => {
        server = Bun.serve({
            port: 0, // random free port
            routes,
        });
    });

    afterAll(() => {
        server.stop();
    });

    test("returns Kodevagt version text", async () => {
        const response = await fetch(`${server.url}/`);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("Kodevagt 0.0.1");
    });
});
