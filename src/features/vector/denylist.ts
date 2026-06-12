const DENY_DIRS = [
    "node_modules",
    "dist",
    "build",
    ".git",
    "vendor",
    "coverage",
    ".next",
    "target",
    "__pycache__",
];

const DENY_EXTENSIONS = new Set([
    ".lock",
    ".min.js",
    ".map",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".zip",
    ".wasm",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
]);

const MAX_FILE_BYTES = 512 * 1024;

export function shouldSkipPath(path: string, size?: number): boolean {
    const normalized = path.replace(/\\/g, "/");
    if (size !== undefined && size > MAX_FILE_BYTES) {
        return true;
    }
    for (const dir of DENY_DIRS) {
        if (normalized.includes(`/${dir}/`) || normalized.startsWith(`${dir}/`)) {
            return true;
        }
    }
    const lower = normalized.toLowerCase();
    for (const ext of DENY_EXTENSIONS) {
        if (lower.endsWith(ext)) {
            return true;
        }
    }
    return false;
}

export function languageFromPath(path: string): string {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const map: Record<string, string> = {
        ts: "typescript",
        tsx: "typescript",
        js: "javascript",
        jsx: "javascript",
        py: "python",
        rs: "rust",
        go: "go",
        java: "java",
        md: "markdown",
        json: "json",
        yaml: "yaml",
        yml: "yaml",
        css: "css",
        html: "html",
        sql: "sql",
        sh: "shell",
    };
    return map[ext] ?? (ext || "text");
}
