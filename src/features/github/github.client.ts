import type { FileContent, FileTree, RepoInfo, FileParams, RepoParams, TreeParams } from "./github.types.ts";

const GITHUB_API = "https://api.github.com";

export type GitHubAuth = {
    token: string;
};

async function githubFetch<T>(path: string, auth: GitHubAuth): Promise<T> {
    const response = await fetch(`${GITHUB_API}${path}`, {
        headers: {
            Authorization: `Bearer ${auth.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { message?: string };
        throw Object.assign(new Error(error.message ?? response.statusText), {
            status: response.status,
        });
    }

    return response.json() as Promise<T>;
}

export async function getRepo(params: RepoParams, auth: GitHubAuth): Promise<RepoInfo> {
    const { owner, repo } = params;
    const data = await githubFetch<{
        id: number;
        name: string;
        full_name: string;
        description: string | null;
        default_branch: string;
        private: boolean;
        html_url: string;
        language: string | null;
        stargazers_count: number;
    }>(`/repos/${owner}/${repo}`, auth);

    return {
        id: data.id,
        name: data.name,
        fullName: data.full_name,
        description: data.description,
        defaultBranch: data.default_branch,
        private: data.private,
        url: data.html_url,
        language: data.language,
        stargazersCount: data.stargazers_count,
    };
}

export async function getTree(params: TreeParams, auth: GitHubAuth): Promise<FileTree> {
    const { owner, repo, ref } = params;
    const branch = ref ?? (await getRepo({ owner, repo }, auth)).defaultBranch;

    const data = await githubFetch<{
        sha: string;
        truncated: boolean;
        tree: Array<{
            path?: string;
            type?: string;
            size?: number;
            sha: string;
        }>;
    }>(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, auth);

    return {
        sha: data.sha,
        truncated: data.truncated,
        files: data.tree
            .filter((node): node is typeof node & { path: string; type: "blob" | "tree" } =>
                typeof node.path === "string" && (node.type === "blob" || node.type === "tree")
            )
            .map((node) => ({
                path: node.path,
                type: node.type,
                size: node.size,
                sha: node.sha,
            })),
    };
}

export async function getFileContent(params: FileParams, auth: GitHubAuth): Promise<FileContent> {
    const { owner, repo, path, ref } = params;
    const refPart = ref ? `?ref=${encodeURIComponent(ref)}` : "";

    const data = await githubFetch<{
        path: string;
        content: string;
        encoding: string;
        size: number;
        sha: string;
    }>(`/repos/${owner}/${repo}/contents/${path}${refPart}`, auth);

    const decoded = Buffer.from(data.content, "base64").toString("utf-8");

    return {
        path: data.path,
        content: decoded,
        encoding: "utf-8",
        size: data.size,
        sha: data.sha,
    };
}
