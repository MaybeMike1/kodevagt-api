export function extractSymbolNames(content: string): string[] {
    const symbols = new Set<string>();
    const patterns = [
        /\bfunction\s+([a-zA-Z_$][\w$]*)/g,
        /\bclass\s+([A-Z][\w$]*)/g,
        /\bdef\s+([a-zA-Z_][\w]*)/g,
        /\bfn\s+([a-zA-Z_][\w]*)/g,
        /\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=/g,
        /\bexport\s+(?:default\s+)?(?:function|class)\s+([a-zA-Z_$][\w$]*)/g,
    ];
    for (const pattern of patterns) {
        for (const match of content.matchAll(pattern)) {
            if (match[1]) symbols.add(match[1]);
        }
    }
    return [...symbols].slice(0, 50);
}

export function extractImports(content: string): string[] {
    const imports: string[] = [];
    for (const line of content.split("\n").slice(0, 80)) {
        const trimmed = line.trim();
        if (
            trimmed.startsWith("import ") ||
            trimmed.startsWith("from ") ||
            trimmed.startsWith("use ") ||
            trimmed.startsWith("#include")
        ) {
            imports.push(trimmed.slice(0, 200));
        }
    }
    return imports.slice(0, 30);
}

export function isTestPath(path: string): boolean {
    const p = path.toLowerCase();
    return (
        p.includes("/test/") ||
        p.includes("/tests/") ||
        p.includes("__tests__") ||
        p.endsWith(".test.ts") ||
        p.endsWith(".spec.ts")
    );
}
