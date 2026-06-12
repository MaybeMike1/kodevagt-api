import { notFound, unauthorized, internalError } from "./errors.ts";

export function githubClientErrorResponse(err: unknown, notFoundResource: string): Response {
    const status = (err as { status?: number }).status;
    const detail = err instanceof Error ? err.message : undefined;
    if (status === 404) return notFound(notFoundResource, detail);
    if (status === 401) return unauthorized();
    return internalError();
}
