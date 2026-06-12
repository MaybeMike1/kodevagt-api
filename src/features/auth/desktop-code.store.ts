const CODE_TTL_MS = 60 * 1000; // 60 seconds

export type DesktopCodePayload = {
    githubToken: string;
    state: string;
    expiresAt: number;
};

const codes = new Map<string, DesktopCodePayload>();

function purgeExpired(): void {
    const now = Date.now();
    for (const [code, entry] of codes) {
        if (entry.expiresAt <= now) codes.delete(code);
    }
}

export function createDesktopCode(githubToken: string, state: string): string {
    purgeExpired();
    const code = crypto.randomUUID();
    codes.set(code, {
        githubToken,
        state,
        expiresAt: Date.now() + CODE_TTL_MS,
    });
    return code;
}

export function consumeDesktopCode(code: string): DesktopCodePayload | null {
    purgeExpired();
    const entry = codes.get(code);
    if (!entry) return null;
    codes.delete(code);
    if (entry.expiresAt <= Date.now()) return null;
    return entry;
}
