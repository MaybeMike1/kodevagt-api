import { describe, expect, test } from "bun:test";
import { errorResponse, internalError, notFound, unauthorized } from "../src/shared/errors.ts";

describe("shared/errors", () => {
    test("errorResponse returns JSON body with status", async () => {
        const res = errorResponse("bad request", 400);
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string; status: number };
        expect(body.error).toBe("bad request");
        expect(body.status).toBe(400);
    });

    test("notFound includes resource name", async () => {
        const res = notFound("Pull request", "missing");
        expect(res.status).toBe(404);
        expect(await res.text()).toContain("Pull request not found");
    });

    test("unauthorized returns 401", () => {
        expect(unauthorized().status).toBe(401);
    });

    test("internalError defaults message", async () => {
        const res = internalError();
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe("Internal server error");
    });
});
