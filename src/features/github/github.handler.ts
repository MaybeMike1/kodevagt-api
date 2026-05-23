import { getRepo, getTree, getFileContent } from "./github.client.ts";
import { notFound, unauthorized, internalError } from "../../shared/errors.ts";

function getRouteParams(req: Request): Record<string, string> {
    return (req as Request & { params?: Record<string, string> }).params ?? {};
}

export async function handleGetRepo(req: Request): Promise<Response> {
    const { owner, repo } = getRouteParams(req);

    try {
        const data = await getRepo({ owner, repo });
        return Response.json(data);
    } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 404) return notFound("Repository");
        if (status === 401) return unauthorized();
        return internalError();
    }
}

export async function handleGetTree(req: Request): Promise<Response> {
    const { owner, repo } = getRouteParams(req);
    const ref = new URL(req.url).searchParams.get("ref") ?? undefined;

    try {
        const data = await getTree({ owner, repo, ref });
        return Response.json(data);
    } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 404) return notFound("Repository");
        if (status === 401) return unauthorized();
        return internalError();
    }
}

export async function handleGetFile(req: Request): Promise<Response> {
    const { owner, repo } = getRouteParams(req);
    const searchParams = new URL(req.url).searchParams;
    const path = searchParams.get("path");
    const ref = searchParams.get("ref") ?? undefined;

    if (!path) {
        return Response.json({ error: "Missing required query parameter: path", status: 400 }, { status: 400 });
    }

    try {
        const data = await getFileContent({ owner, repo, path, ref });
        return Response.json(data);
    } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 404) return notFound("File");
        if (status === 401) return unauthorized();
        return internalError();
    }
}
