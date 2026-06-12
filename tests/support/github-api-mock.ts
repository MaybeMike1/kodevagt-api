/** Raw GitHub REST API response shapes (snake_case) */

export const GITHUB_REPO = {
    id: 1296269,
    name: "Hello-World",
    full_name: "octocat/Hello-World",
    owner: { login: "octocat" },
    description: "My first repository on GitHub!",
    default_branch: "main",
    private: false,
    html_url: "https://github.com/octocat/Hello-World",
    language: "TypeScript",
    stargazers_count: 2048,
};

export const GITHUB_USER_REPOS = [
    GITHUB_REPO,
    {
        id: 2,
        name: "Spoon-Knife",
        full_name: "octocat/Spoon-Knife",
        owner: { login: "octocat" },
        description: null,
        default_branch: "main",
        private: false,
        html_url: "https://github.com/octocat/Spoon-Knife",
        language: null,
        stargazers_count: 100,
    },
];

export const GITHUB_TREE = {
    sha: "abc123",
    truncated: false,
    tree: [
        { path: "README.md", type: "blob", size: 42, sha: "def456" },
        { path: "src", type: "tree", sha: "ghi789" },
        { path: "src/index.ts", type: "blob", size: 512, sha: "jkl012" },
        { path: ".github", type: "commit", sha: "ignored" },
    ],
};

export const GITHUB_PULL_DETAIL = {
    number: 42,
    title: "Add feature",
    body: "## Summary\n\nAdds the new feature.\n",
    state: "open",
    merged: false,
    merged_at: null,
    html_url: "https://github.com/octocat/Hello-World/pull/42",
    created_at: "2024-01-15T10:00:00Z",
    updated_at: "2024-01-16T12:00:00Z",
    user: {
        login: "octocat",
        avatar_url: "https://github.com/images/error/octocat_happy.gif",
    },
    head: { ref: "feature-branch", sha: "abc123def456789012345678901234567890abcd" },
    base: { ref: "main" },
    draft: false,
    additions: 24,
    deletions: 6,
    changed_files: 2,
    labels: [{ name: "enhancement", color: "a2eeef" }],
};

export const GITHUB_PULL_FILES = [
    {
        filename: "src/feature.ts",
        status: "added",
        additions: 18,
        deletions: 0,
        changes: 18,
        patch: "@@ -0,0 +1,3 @@\n+export function feature() {\n+  return true;\n+}\n",
    },
    {
        filename: "README.md",
        status: "modified",
        additions: 6,
        deletions: 6,
        changes: 12,
        patch: "@@ -1,3 +1,3 @@\n-# Hello\n+# Hello World\n",
    },
];

export const GITHUB_PULL_COMMITS = [
    {
        sha: "abc123def456",
        commit: {
            message: "Add feature implementation",
            author: { date: "2024-01-15T10:00:00Z", name: "octocat" },
        },
        author: {
            login: "octocat",
            avatar_url: "https://github.com/images/error/octocat_happy.gif",
        },
    },
];

export const GITHUB_PULLS = [
    {
        number: 42,
        title: "Add feature",
        state: "open",
        html_url: "https://github.com/octocat/Hello-World/pull/42",
        created_at: "2024-01-15T10:00:00Z",
        updated_at: "2024-01-16T12:00:00Z",
        user: {
            login: "octocat",
            avatar_url: "https://github.com/images/error/octocat_happy.gif",
        },
        head: { ref: "feature-branch" },
        base: { ref: "main" },
        draft: false,
    },
    {
        number: 41,
        title: "Fix bug",
        state: "closed",
        html_url: "https://github.com/octocat/Hello-World/pull/41",
        created_at: "2024-01-10T08:00:00Z",
        updated_at: "2024-01-12T09:00:00Z",
        user: {
            login: "hubot",
            avatar_url: "https://github.com/images/error/hubot_happy.gif",
        },
        head: { ref: "fix-branch" },
        base: { ref: "main" },
    },
];

export const GITHUB_FILE = {
    name: "README.md",
    path: "README.md",
    type: "file",
    content: Buffer.from("# Hello World\n").toString("base64"),
    encoding: "base64",
    size: 14,
    sha: "def456",
    download_url: "https://raw.githubusercontent.com/octocat/Hello-World/main/README.md",
};

export const GITHUB_ROOT_CONTENTS = [
    {
        name: "README.md",
        path: "README.md",
        type: "file",
        size: 14,
        sha: "def456",
        download_url: "https://raw.githubusercontent.com/octocat/Hello-World/main/README.md",
    },
    {
        name: "src",
        path: "src",
        type: "dir",
        size: 0,
        sha: "ghi789",
        download_url: null,
    },
    {
        name: "package.json",
        path: "package.json",
        type: "file",
        size: 256,
        sha: "mno345",
        download_url: null,
    },
];

export const GITHUB_BRANCHES = [
    { name: "main", commit: { sha: "abc123" }, protected: true },
    { name: "develop", commit: { sha: "def456" } },
];

export const GITHUB_COMMITS = [
    {
        sha: "abc123",
        commit: { message: "Initial commit" },
    },
];

function githubApiResponse(url: string): Response {
    if (url.includes("/user/repos")) {
        return Response.json(GITHUB_USER_REPOS);
    }
    if (url.match(/\/repos\/[^/]+\/[^/]+\/git\/trees\//)) {
        return Response.json(GITHUB_TREE);
    }
    if (url.match(/\/repos\/[^/]+\/[^/]+\/branches/)) {
        return Response.json(GITHUB_BRANCHES);
    }
    if (url.match(/\/repos\/[^/]+\/[^/]+\/commits/)) {
        return Response.json(GITHUB_COMMITS, {
            headers: {
                Link: '<https://api.github.com/repos/octocat/Hello-World/commits?page=42>; rel="last"',
            },
        });
    }
    if (url.match(/\/repos\/[^/]+\/[^/]+\/contents(\?|$)/)) {
        return Response.json(GITHUB_ROOT_CONTENTS);
    }
    if (url.match(/\/repos\/[^/]+\/[^/]+\/contents\//)) {
        return Response.json(GITHUB_FILE);
    }
    if (url.match(/\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/files/)) {
        return Response.json(GITHUB_PULL_FILES);
    }
    if (url.match(/\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/commits/)) {
        return Response.json(GITHUB_PULL_COMMITS);
    }
    if (url.match(/\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/)) {
        return Response.json(GITHUB_PULL_DETAIL);
    }
    if (url.match(/\/repos\/[^/]+\/[^/]+\/pulls(\?|$)/)) {
        return Response.json(GITHUB_PULLS);
    }
    if (url.match(/\/repos\/[^/]+\/not-found/)) {
        return Response.json({ message: "Not Found" }, { status: 404 });
    }
    if (url.match(/\/repos\/[^/]+\/[^/]+$/)) {
        return Response.json(GITHUB_REPO);
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
}

export function installGitHubFetchMock() {
    const originalFetch = global.fetch;

    const mockFetch = (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
    ) => {
        const url = input.toString();
        if (url.startsWith("https://api.github.com")) {
            return Promise.resolve(githubApiResponse(url));
        }
        return originalFetch(input, init);
    };

    global.fetch = Object.assign(mockFetch, {
        preconnect: originalFetch.preconnect,
    });

    return () => {
        global.fetch = originalFetch;
    };
}
