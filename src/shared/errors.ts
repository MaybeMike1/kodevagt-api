export type ApiError = {
    error: string;
    status: number;
};

export function errorResponse(message: string, status: number): Response {
    const body: ApiError = { error: message, status };
    return Response.json(body, { status });
}

export function notFound(resource = "Resource", detail?: string): Response {
    const message = detail ? `${resource} not found: ${detail}` : `${resource} not found`;
    return errorResponse(message, 404);
}

export function unauthorized(): Response {
    return errorResponse("Invalid or missing GitHub token", 401);
}

export function internalError(message = "Internal server error"): Response {
    return errorResponse(message, 500);
}
