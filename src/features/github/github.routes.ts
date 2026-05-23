import { handleGetRepo, handleGetTree, handleGetFile } from "./github.handler.ts";

export const githubRoutes = {
    "/github/repos/:owner/:repo": handleGetRepo,
    "/github/repos/:owner/:repo/tree": handleGetTree,
    "/github/repos/:owner/:repo/file": handleGetFile,
};
