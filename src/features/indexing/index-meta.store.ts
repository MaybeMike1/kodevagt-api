import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../../shared/config.ts";
import type { IndexMeta } from "../vector/vector.types.ts";

const metaMap = new Map<string, IndexMeta>();

function key(owner: string, repo: string, ref: string): string {
    return `${owner}/${repo}@${ref}`;
}

function metaFilePath(owner: string, repo: string, ref: string): string {
    return join(
        config.vectorDbPath,
        "meta",
        `${owner}__${repo}__${ref}.json`,
    );
}

export function getIndexMeta(owner: string, repo: string, ref: string): IndexMeta | null {
    return metaMap.get(key(owner, repo, ref)) ?? null;
}

export function setIndexMeta(meta: IndexMeta): void {
    metaMap.set(key(meta.owner, meta.repo, meta.ref), meta);
}

export function deleteIndexMeta(owner: string, repo: string, ref: string): void {
    metaMap.delete(key(owner, repo, ref));
}

/** Test helper */
export function resetIndexMetaForTests(): void {
    metaMap.clear();
}

export async function loadIndexMeta(
    owner: string,
    repo: string,
    ref: string,
): Promise<IndexMeta | null> {
    const cached = getIndexMeta(owner, repo, ref);
    if (cached) return cached;

    const file = Bun.file(metaFilePath(owner, repo, ref));
    if (!(await file.exists())) return null;

    try {
        const meta = (await file.json()) as IndexMeta;
        setIndexMeta(meta);
        return meta;
    } catch {
        return null;
    }
}

export async function persistIndexMeta(meta: IndexMeta): Promise<void> {
    setIndexMeta(meta);
    const dir = join(config.vectorDbPath, "meta");
    await mkdir(dir, { recursive: true });
    await Bun.write(metaFilePath(meta.owner, meta.repo, meta.ref), JSON.stringify(meta, null, 2));
}
