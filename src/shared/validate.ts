const SLUG = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,98}[a-zA-Z0-9])?$/;

export function validateOwnerRepo(owner: string, repo: string): string | null {
    if (!owner?.trim()) return "Owner is required";
    if (!repo?.trim()) return "Repository name is required";
    if (repo === "Undefined" || owner === "Undefined") {
        return "Invalid repository identifier";
    }
    if (!SLUG.test(owner)) return `Invalid owner: ${owner}`;
    if (!SLUG.test(repo)) return `Invalid repository name: ${repo}`;
    return null;
}
