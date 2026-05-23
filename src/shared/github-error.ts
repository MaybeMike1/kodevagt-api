import { notFound, unauthorized, internalError } from "./errors.ts";

export function githubClientErrorResponse(err: unknown, notFoundResource: string): Response {
    const status = (err as { status?: number }).status;
    if (status === 404) return notFound(notFoundResource);
    if (status === 401) return unauthorized();
    return internalError();
}
