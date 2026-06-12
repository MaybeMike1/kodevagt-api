import { config } from "../../shared/config.ts";
import { extractImports, extractSymbolNames, isTestPath } from "./chunker.enrich.ts";
import { languageFromPath } from "./denylist.ts";
import type { CodeChunk } from "./vector.types.ts";

const SPLIT_PATTERNS = [
    /^export\s+/m,
    /^function\s+/m,
    /^class\s+/m,
    /^def\s+/m,
    /^fn\s+/m,
    /^impl\s+/m,
    /^pub\s+fn\s+/m,
    /^\/\/ ---/m,
    /^\s*$/m,
];

export type RawChunk = {
    content: string;
    lineStart: number;
    lineEnd: number;
};

export function chunkFileContent(
    path: string,
    content: string,
    options?: { maxChars?: number; overlapRatio?: number },
): RawChunk[] {
    const maxChars = options?.maxChars ?? config.indexChunkChars;
    const overlapRatio = options?.overlapRatio ?? config.indexChunkOverlap;
    const lines = content.split("\n");
    const chunks: RawChunk[] = [];

    let startLine = 0;
    let buffer: string[] = [];
    let bufferChars = 0;

    const flush = (endLine: number) => {
        if (buffer.length === 0) return;
        chunks.push({
            content: buffer.join("\n"),
            lineStart: startLine + 1,
            lineEnd: endLine,
        });
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const isBoundary =
            bufferChars > maxChars * 0.6 &&
            SPLIT_PATTERNS.some((p) => p.test(line)) &&
            buffer.length > 0;

        if (isBoundary && bufferChars >= maxChars * 0.5) {
            flush(i);
            const overlapLines = Math.max(
                1,
                Math.floor(buffer.length * overlapRatio),
            );
            const tail = buffer.slice(-overlapLines);
            buffer = [...tail];
            bufferChars = buffer.join("\n").length;
            startLine = i - tail.length;
        }

        buffer.push(line);
        bufferChars += line.length + 1;

        if (bufferChars >= maxChars) {
            flush(i + 1);
            const overlapLines = Math.max(
                1,
                Math.floor(buffer.length * overlapRatio),
            );
            const tail = buffer.slice(-overlapLines);
            buffer = [...tail];
            bufferChars = buffer.join("\n").length;
            startLine = i + 1 - tail.length;
        }
    }

    if (buffer.length > 0) {
        flush(lines.length);
    }

    if (chunks.length === 0 && content.trim().length > 0) {
        chunks.push({ content, lineStart: 1, lineEnd: lines.length });
    }

    return chunks;
}

export function buildCodeChunks(params: {
    owner: string;
    repo: string;
    ref: string;
    path: string;
    fileSha: string;
    content: string;
    embeddings: number[][];
}): CodeChunk[] {
    const rawChunks = chunkFileContent(params.path, params.content);
    const language = languageFromPath(params.path);
    const directory = params.path.includes("/")
        ? params.path.slice(0, params.path.lastIndexOf("/"))
        : "";
    const indexedAt = new Date().toISOString();

    return rawChunks.map((raw, index) => ({
        id: crypto.randomUUID(),
        owner: params.owner,
        repo: params.repo,
        ref: params.ref,
        path: params.path,
        chunkIndex: index,
        content: raw.content,
        embedding: params.embeddings[index] ?? [],
        language,
        symbolNames: extractSymbolNames(raw.content),
        imports: extractImports(params.content),
        lineStart: raw.lineStart,
        lineEnd: raw.lineEnd,
        fileSha: params.fileSha,
        indexedAt,
        isTest: isTestPath(params.path),
        directory,
    }));
}

export function embeddingInputForChunk(path: string, content: string, symbols: string[]): string {
    const symbolLine = symbols.length > 0 ? `\n${symbols.join(" ")}` : "";
    return `${path}${symbolLine}\n${content}`;
}
