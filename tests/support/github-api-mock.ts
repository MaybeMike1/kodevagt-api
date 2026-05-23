/** Raw GitHub REST API response shapes (snake_case) */

export const GITHUB_REPO = {
    id: 1296269,
    name: "Hello-World",
    full_name: "octocat/Hello-World",
    description: "My first repository on GitHub!",
    default_branch: "main",
    private: false,
    html_url: "https://github.com/octocat/Hello-World",
    language: "TypeScript",
    stargazers_count: 2048,
};

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

export const GITHUB_FILE = {
    path: "README.md",
    content: Buffer.from("# Hello World\n").toString("base64"),
    encoding: "base64",
    size: 14,
    sha: "def456",
};

function githubApiResponse(url: string): Response {
    if (url.match(/\/repos\/[^/]+\/[^/]+\/git\/trees\//)) {
        return Response.json(GITHUB_TREE);
    }
    if (url.match(/\/repos\/[^/]+\/[^/]+\/contents\//)) {
        return Response.json(GITHUB_FILE);
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
