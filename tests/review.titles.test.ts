import { describe, expect, test } from "bun:test";
import {
    defaultFindingConfidence,
    deriveFindingTitle,
    resolveRawConfidence,
} from "../src/features/review/review.titles.ts";

describe("review.titles", () => {
    test("deriveFindingTitle uses first sentence when title is Finding", () => {
        const title = deriveFindingTitle({
            title: "Finding",
            body: "The redirectToFrontendWithError helper uses a hardcoded error code. Consider using a typed enum.",
            file: "src/features/auth/auth.routes.ts",
            line: 108,
        });
        expect(title).toContain("redirectToFrontendWithError");
        expect(title.toLowerCase()).not.toBe("finding");
    });

    test("deriveFindingTitle falls back to file:line", () => {
        const title = deriveFindingTitle({
            title: "Finding",
            body: "short",
            file: "src/features/auth/auth.routes.ts",
            line: 108,
        });
        expect(title).toBe("auth.routes.ts:108");
    });

    test("resolveRawConfidence avoids flat 0.5 default", () => {
        expect(
            resolveRawConfidence(undefined, {
                file: "src/a.ts",
                line: 12,
                body: "Long enough body for a substantive review note here.",
            }),
        ).toBeGreaterThan(0.5);
        expect(defaultFindingConfidence({ file: "a.ts", body: "" })).toBe(0.6);
    });
});
