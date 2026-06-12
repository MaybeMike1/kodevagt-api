const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

type PendingDesktopFlow = {
    state: string;
    redirectUri?: string;
    expiresAt: number;
};

const pendingByState = new Map<string, PendingDesktopFlow>();

function purgeExpired(): void {
    const now = Date.now();
    for (const [state, entry] of pendingByState) {
        if (entry.expiresAt <= now) pendingByState.delete(state);
    }
}

export function registerDesktopFlow(state: string, redirectUri?: string): void {
    purgeExpired();
    pendingByState.set(state, {
        state,
        redirectUri,
        expiresAt: Date.now() + PENDING_TTL_MS,
    });
}

function getEntry(state: string): PendingDesktopFlow | undefined {
    purgeExpired();
    const entry = pendingByState.get(state);
    if (!entry || entry.expiresAt <= Date.now()) {
        pendingByState.delete(state);
        return undefined;
    }
    return entry;
}

export function isDesktopFlow(state: string): boolean {
    return getEntry(state) !== undefined;
}

export function consumeDesktopFlow(state: string): PendingDesktopFlow | undefined {
    const entry = getEntry(state);
    if (!entry) return undefined;
    pendingByState.delete(state);
    return entry;
}
