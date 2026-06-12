import { describe, expect, test } from "bun:test";
import {
    extractChangedLineRangesFromPatch,
    extractSymbolsFromPatch,
} from "../src/features/retrieval/retrieval.query.ts";

const SAMPLE_PATCH = `diff --git a/src/auth.ts b/src/auth.ts
index abc..def 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,6 +10,9 @@ export class AuthService {
   validateToken(token: string) {
     return this.store.get(token);
   }
+
+  async revokeToken(token: string) {
+    await this.store.delete(token);
+  }
 }`;

describe("extractSymbolsFromPatch", () => {
    test("captures declarations and call sites from diff lines", () => {
        const symbols = extractSymbolsFromPatch(SAMPLE_PATCH);
        expect(symbols).toContain("revokeToken");
        expect(symbols).toContain("delete");
    });
});

describe("extractChangedLineRangesFromPatch", () => {
    test("returns new-file line numbers for added and removed lines", () => {
        const lines = extractChangedLineRangesFromPatch(SAMPLE_PATCH);
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.some((l) => l >= 13 && l <= 16)).toBe(true);
    });

    test("returns empty array for missing patch", () => {
        expect(extractChangedLineRangesFromPatch(null)).toEqual([]);
    });
});
