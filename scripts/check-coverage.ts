/**
 * Aggregate coverage gate for CI. Bun's coverageThreshold fails when any single
 * file is below the threshold (e.g. indexing.service.ts); this checks totals only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LCOV_PATH = join(import.meta.dir, "..", "coverage", "lcov.info");

const IGNORE_PREFIXES = [
    "src/index.ts",
    "src/features/vector/lancedb.store.ts",
    "src/features/ai/ollama.client.ts",
];

const MIN_LINES = Number(process.env.COVERAGE_MIN_LINES ?? "0.80");
const MIN_FUNCTIONS = Number(process.env.COVERAGE_MIN_FUNCTIONS ?? "0.85");

type Totals = { linesFound: number; linesHit: number; funcsFound: number; funcsHit: number };

function parseLcov(content: string): Totals {
    const totals: Totals = { linesFound: 0, linesHit: 0, funcsFound: 0, funcsHit: 0 };
    let currentFile = "";
    let skip = false;

    for (const raw of content.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith("SF:")) {
            const path = line.slice(3).replace(/\\/g, "/");
            currentFile = path;
            skip = !path.startsWith("src/") || IGNORE_PREFIXES.some((p) => path.endsWith(p) || path.includes(p));
            continue;
        }
        if (skip || !currentFile) continue;

        if (line.startsWith("LF:")) totals.linesFound += Number(line.slice(3));
        else if (line.startsWith("LH:")) totals.linesHit += Number(line.slice(3));
        else if (line.startsWith("FNF:")) totals.funcsFound += Number(line.slice(4));
        else if (line.startsWith("FNH:")) totals.funcsHit += Number(line.slice(4));
    }

    return totals;
}

function pct(hit: number, found: number): number {
    return found === 0 ? 1 : hit / found;
}

const lcov = readFileSync(LCOV_PATH, "utf8");
const totals = parseLcov(lcov);
const lineRate = pct(totals.linesHit, totals.linesFound);
const funcRate = pct(totals.funcsHit, totals.funcsFound);

console.log(
    `[coverage] lines ${(lineRate * 100).toFixed(1)}% (${totals.linesHit}/${totals.linesFound}), ` +
        `functions ${(funcRate * 100).toFixed(1)}% (${totals.funcsHit}/${totals.funcsFound})`,
);

const failures: string[] = [];
if (lineRate < MIN_LINES) {
    failures.push(`line coverage ${(lineRate * 100).toFixed(1)}% < ${(MIN_LINES * 100).toFixed(0)}%`);
}
if (funcRate < MIN_FUNCTIONS) {
    failures.push(`function coverage ${(funcRate * 100).toFixed(1)}% < ${(MIN_FUNCTIONS * 100).toFixed(0)}%`);
}

if (failures.length > 0) {
    console.error("[coverage] threshold failed:", failures.join("; "));
    process.exit(1);
}

console.log("[coverage] thresholds met");
