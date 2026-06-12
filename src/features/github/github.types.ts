export type RepoParams = {
    owner: string;
    repo: string;
};

export type ListReposParams = {
    page?: number;
    perPage?: number;
    sort?: "created" | "updated" | "pushed" | "full_name";
    direction?: "asc" | "desc";
    affiliation?: string;
};

export type RepoListItem = {
    id: number;
    name: string;
    fullName: string;
    owner: string;
    description: string | null;
    defaultBranch: string;
    private: boolean;
    url: string;
    language: string | null;
    stargazersCount: number;
};

export type RepoList = {
    repos: RepoListItem[];
};

export type FileParams = RepoParams & {
    path: string;
    ref?: string;
};

export type TreeParams = RepoParams & {
    ref?: string;
};

export type RepoInfo = {
    id: number;
    name: string;
    fullName: string;
    description: string | null;
    defaultBranch: string;
    private: boolean;
    url: string;
    language: string | null;
    stargazersCount: number;
};

export type FileNode = {
    path: string;
    type: "blob" | "tree";
    size?: number;
    sha: string;
};

export type FileTree = {
    sha: string;
    truncated: boolean;
    files: FileNode[];
};

export type FileContent = {
    path: string;
    content: string;
    encoding: "utf-8";
    size: number;
    sha: string;
};

export type ContentsParams = RepoParams & {
    path?: string;
    ref?: string;
};

export type ContentItemType = "file" | "dir";

export type ContentItem = {
    name: string;
    path: string;
    sha: string;
    size: number;
    type: ContentItemType;
    downloadUrl: string | null;
};

export type ContentFileEntry = ContentItem & {
    type: "file";
    content: string;
    encoding: string;
};

export type ContentsResult = ContentItem[] | ContentFileEntry;

export type ListBranchesParams = RepoParams & {
    page?: number;
    perPage?: number;
};

export type Branch = {
    name: string;
    commit: { sha: string };
    protected?: boolean;
};

export type ListCommitsParams = RepoParams & {
    sha?: string;
    perPage?: number;
    page?: number;
};

export type ListPullsParams = RepoParams & {
    state?: "open" | "closed" | "all";
    head?: string;
    base?: string;
    sort?: "created" | "updated" | "popularity" | "long-running";
    direction?: "asc" | "desc";
    page?: number;
    perPage?: number;
};

export type PullRequestListItem = {
    number: number;
    title: string;
    state: string;
    htmlUrl: string;
    createdAt: string;
    updatedAt: string;
    user: {
        login: string;
        avatarUrl: string;
    };
    headRef: string;
    baseRef: string;
    draft?: boolean;
};

export type PullRequestList = {
    pulls: PullRequestListItem[];
};

export type PullRequestParams = RepoParams & {
    number: number;
};

export type PullRequestLabel = {
    name: string;
    color: string;
};

export type PullRequestDetail = {
    number: number;
    title: string;
    body: string | null;
    state: string;
    merged: boolean;
    mergedAt: string | null;
    createdAt: string;
    updatedAt: string;
    htmlUrl: string;
    user: {
        login: string;
        avatarUrl: string;
    };
    headRef: string;
    baseRef: string;
    draft?: boolean;
    additions: number;
    deletions: number;
    changedFiles: number;
    labels: PullRequestLabel[];
};

export type PullRequestFileStatus =
    | "added"
    | "modified"
    | "removed"
    | "renamed"
    | "copied"
    | "changed"
    | "unchanged";

export type PullRequestFile = {
    filename: string;
    status: PullRequestFileStatus;
    additions: number;
    deletions: number;
    changes: number;
    patch: string | null;
    previousFilename?: string | null;
};

export type PullRequestFileList = {
    files: PullRequestFile[];
};

export type PullRequestCommit = {
    sha: string;
    message: string;
    author: {
        login: string;
        avatarUrl: string | null;
    } | null;
    committedAt: string;
};

export type PullRequestCommitList = {
    commits: PullRequestCommit[];
};
