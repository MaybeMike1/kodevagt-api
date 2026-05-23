export type RepoParams = {
    owner: string;
    repo: string;
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
