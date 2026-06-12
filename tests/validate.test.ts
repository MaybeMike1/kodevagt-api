import { describe, expect, test } from "bun:test";
import { validateOwnerRepo } from "../src/shared/validate.ts";

describe("validateOwnerRepo", () => {
    test("accepts valid slugs", () => {
        expect(validateOwnerRepo("MaybeMike1", "kodevagt-api")).toBeNull();
    });

    test("rejects Undefined repo", () => {
        expect(validateOwnerRepo("MaybeMike1", "Undefined")).toMatch(/invalid/i);
    });

    test("rejects empty owner", () => {
        expect(validateOwnerRepo("", "repo")).toMatch(/owner/i);
    });
});
