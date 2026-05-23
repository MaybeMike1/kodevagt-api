import { describe, test, expect } from "bun:test";
import { app } from "../src/app.ts";

describe("GET /", () => {
    test("returns Kodevagt version text", async () => {
        const response = await app.request("/");

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("Kodevagt 0.0.1");
    });
});
