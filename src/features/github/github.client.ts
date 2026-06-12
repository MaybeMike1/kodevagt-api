import type {
    Branch,
    ContentFileEntry,
    ContentItem,
    ContentsResult,
    FileContent,
    FileTree,
    ListBranchesParams,
    ListCommitsParams,
    ListPullsParams,
    ListReposParams,
    PullRequestCommit,
    PullRequestDetail,
    PullRequestFile,
    PullRequestList,
    PullRequestListItem,
    PullRequestParams,
    RepoInfo,
    RepoList,
    RepoListItem,
    ContentsParams,
    FileParams,
    RepoParams,
    TreeParams,
} from "./github.types.ts";

const GITHUB_API = "https://api.github.com";

export type GitHubAuth = {
    token: string;
};

function githubHeaders(auth: GitHubAuth): Record<string, string> {
    return {
        Authorization: `Bearer ${auth.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };
}

async function githubFetch<T>(path: string, auth: GitHubAuth): Promise<T> {
    const response = await fetch(`${GITHUB_API}${path}`, {
        headers: githubHeaders(auth),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { message?: string };
        throw Object.assign(new Error(error.message ?? response.statusText), {
            status: response.status,
        });
    }

    return response.json() as Promise<T>;
}

async function githubFetchResponse(path: string, auth: GitHubAuth): Promise<Response> {
    const response = await fetch(`${GITHUB_API}${path}`, {
        headers: githubHeaders(auth),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { message?: string };
        throw Object.assign(new Error(error.message ?? response.statusText), {
            status: response.status,
        });
    }

    return response;
}

function mapRepoListItem(data: {
    id: number;
    name: string;
    full_name: string;
    owner: { login: string };
    description: string | null;
    default_branch: string;
    private: boolean;
    html_url: string;
    language: string | null;
    stargazers_count: number;
}): RepoListItem {
    return {
        id: data.id,
        name: data.name,
        fullName: data.full_name,
        owner: data.owner.login,
        description: data.description,
        defaultBranch: data.default_branch,
        private: data.private,
        url: data.html_url,
        language: data.language,
        stargazersCount: data.stargazers_count,
    };
}

export async function listUserRepos(params: ListReposParams, auth: GitHubAuth): Promise<RepoList> {
    const search = new URLSearchParams();
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.perPage !== undefined) search.set("per_page", String(params.perPage));
    if (params.sort) search.set("sort", params.sort);
    if (params.direction) search.set("direction", params.direction);
    if (params.affiliation) search.set("affiliation", params.affiliation);

    const query = search.toString();
    const path = query ? `/user/repos?${query}` : "/user/repos";

    const data = await githubFetch<
        Array<{
            id: number;
            name: string;
            full_name: string;
            owner: { login: string };
            description: string | null;
            default_branch: string;
            private: boolean;
            html_url: string;
            language: string | null;
            stargazers_count: number;
        }>
    >(path, auth);

    return { repos: data.map(mapRepoListItem) };
}

function mapPullRequestListItem(data: {
    number: number;
    title: string;
    state: string;
    html_url: string;
    created_at: string;
    updated_at: string;
    user: { login: string; avatar_url: string };
    head: { ref: string };
    base: { ref: string };
    draft?: boolean;
}): PullRequestListItem {
    return {
        number: data.number,
        title: data.title,
        state: data.state,
        htmlUrl: data.html_url,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        user: {
            login: data.user.login,
            avatarUrl: data.user.avatar_url,
        },
        headRef: data.head.ref,
        baseRef: data.base.ref,
        draft: data.draft,
    };
}

export async function listPullRequests(
    params: ListPullsParams,
    auth: GitHubAuth,
): Promise<PullRequestList> {
    const { owner, repo, state, head, base, sort, direction, page, perPage } = params;
    const search = new URLSearchParams();
    if (state) search.set("state", state);
    if (head) search.set("head", head);
    if (base) search.set("base", base);
    if (sort) search.set("sort", sort);
    if (direction) search.set("direction", direction);
    if (page !== undefined) search.set("page", String(page));
    if (perPage !== undefined) search.set("per_page", String(perPage));

    const query = search.toString();
    const path = query
        ? `/repos/${owner}/${repo}/pulls?${query}`
        : `/repos/${owner}/${repo}/pulls`;

    const data = await githubFetch<
        Array<{
            number: number;
            title: string;
            state: string;
            html_url: string;
            created_at: string;
            updated_at: string;
            user: { login: string; avatar_url: string };
            head: { ref: string };
            base: { ref: string };
            draft?: boolean;
        }>
    >(path, auth);

    return { pulls: data.map(mapPullRequestListItem) };
}

function mapPullRequestState(data: { state: string; merged?: boolean }): string {
    if (data.merged) return "merged";
    return data.state;
}

function mapPullRequestDetail(data: {
    number: number;
    title: string;
    body: string | null;
    state: string;
    merged?: boolean;
    merged_at: string | null;
    created_at: string;
    updated_at: string;
    html_url: string;
    user: { login: string; avatar_url: string };
    head: { ref: string };
    base: { ref: string };
    draft?: boolean;
    additions: number;
    deletions: number;
    changed_files: number;
    labels: Array<{ name: string; color: string }>;
}): PullRequestDetail {
    return {
        number: data.number,
        title: data.title,
        body: data.body,
        state: mapPullRequestState(data),
        merged: data.merged ?? false,
        mergedAt: data.merged_at,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        htmlUrl: data.html_url,
        user: {
            login: data.user.login,
            avatarUrl: data.user.avatar_url,
        },
        headRef: data.head.ref,
        baseRef: data.base.ref,
        draft: data.draft,
        additions: data.additions,
        deletions: data.deletions,
        changedFiles: data.changed_files,
        labels: data.labels.map((label) => ({
            name: label.name,
            color: label.color,
        })),
    };
}

function mapPullRequestFile(data: {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string | null;
    previous_filename?: string | null;
}): PullRequestFile {
    return {
        filename: data.filename,
        status: data.status as PullRequestFile["status"],
        additions: data.additions,
        deletions: data.deletions,
        changes: data.changes,
        patch: data.patch ?? null,
        previousFilename: data.previous_filename ?? null,
    };
}

function mapPullRequestCommit(data: {
    sha: string;
    commit: { message: string; author: { date: string; name?: string } | null };
    author: { login: string; avatar_url: string } | null;
}): PullRequestCommit {
    return {
        sha: data.sha,
        message: data.commit.message,
        author: data.author
            ? {
                  login: data.author.login,
                  avatarUrl: data.author.avatar_url,
              }
            : null,
        committedAt: data.commit.author?.date ?? "",
    };
}

export async function getPullRequest(
    params: PullRequestParams,
    auth: GitHubAuth,
): Promise<PullRequestDetail> {
    const { owner, repo, number } = params;
    const data = await githubFetch<{
        number: number;
        title: string;
        body: string | null;
        state: string;
        merged?: boolean;
        merged_at: string | null;
        created_at: string;
        updated_at: string;
        html_url: string;
        user: { login: string; avatar_url: string };
        head: { ref: string };
        base: { ref: string };
        draft?: boolean;
        additions: number;
        deletions: number;
        changed_files: number;
        labels: Array<{ name: string; color: string }>;
    }>(`/repos/${owner}/${repo}/pulls/${number}`, auth);

    return mapPullRequestDetail(data);
}

export async function listPullRequestFiles(
    params: PullRequestParams,
    auth: GitHubAuth,
): Promise<PullRequestFileList> {
    const { owner, repo, number } = params;
    const data = await githubFetch<
        Array<{
            filename: string;
            status: string;
            additions: number;
            deletions: number;
            changes: number;
            patch?: string | null;
            previous_filename?: string | null;
        }>
    >(`/repos/${owner}/${repo}/pulls/${number}/files`, auth);

    return { files: data.map(mapPullRequestFile) };
}

export async function listPullRequestCommits(
    params: PullRequestParams,
    auth: GitHubAuth,
): Promise<PullRequestCommitList> {
    const { owner, repo, number } = params;
    const data = await githubFetch<
        Array<{
            sha: string;
            commit: { message: string; author: { date: string } | null };
            author: { login: string; avatar_url: string } | null;
        }>
    >(`/repos/${owner}/${repo}/pulls/${number}/commits`, auth);

    return { commits: data.map(mapPullRequestCommit) };
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

type GitHubContentRaw = {
    name: string;
    path: string;
    sha: string;
    size: number;
    type: "file" | "dir" | "symlink" | "submodule";
    download_url: string | null;
    content?: string;
    encoding?: string;
};

function mapContentItem(data: GitHubContentRaw): ContentItem {
    return {
        name: data.name,
        path: data.path,
        sha: data.sha,
        size: data.size,
        type: data.type === "dir" ? "dir" : "file",
        downloadUrl: data.download_url,
    };
}

function mapContentFile(data: GitHubContentRaw): ContentFileEntry {
    return {
        ...mapContentItem(data),
        type: "file",
        content: data.content ?? "",
        encoding: data.encoding ?? "base64",
    };
}

export async function getContents(params: ContentsParams, auth: GitHubAuth): Promise<ContentsResult> {
    const { owner, repo, path, ref } = params;
    const refPart = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const contentPath = path ? `/${path}` : "";

    const data = await githubFetch<GitHubContentRaw | GitHubContentRaw[]>(
        `/repos/${owner}/${repo}/contents${contentPath}${refPart}`,
        auth,
    );

    if (Array.isArray(data)) {
        return data
            .filter((item) => item.type === "file" || item.type === "dir")
            .map(mapContentItem);
    }

    return mapContentFile(data);
}

export async function listBranches(params: ListBranchesParams, auth: GitHubAuth): Promise<Branch[]> {
    const { owner, repo, page, perPage } = params;
    const search = new URLSearchParams();
    if (page !== undefined) search.set("page", String(page));
    if (perPage !== undefined) search.set("per_page", String(perPage));

    const query = search.toString();
    const path = query
        ? `/repos/${owner}/${repo}/branches?${query}`
        : `/repos/${owner}/${repo}/branches`;

    const data = await githubFetch<
        Array<{
            name: string;
            commit: { sha: string };
            protected?: boolean;
        }>
    >(path, auth);

    return data.map((branch) => ({
        name: branch.name,
        commit: { sha: branch.commit.sha },
        protected: branch.protected,
    }));
}

export async function listCommits(
    params: ListCommitsParams,
    auth: GitHubAuth,
): Promise<{ commits: unknown[]; link: string | null }> {
    const { owner, repo, sha, perPage, page } = params;
    const search = new URLSearchParams();
    if (sha) search.set("sha", sha);
    if (perPage !== undefined) search.set("per_page", String(perPage));
    if (page !== undefined) search.set("page", String(page));

    const query = search.toString();
    const path = query
        ? `/repos/${owner}/${repo}/commits?${query}`
        : `/repos/${owner}/${repo}/commits`;

    const response = await githubFetchResponse(path, auth);
    const commits = (await response.json()) as unknown[];

    return { commits, link: response.headers.get("Link") };
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
