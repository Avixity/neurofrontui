export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError)
    return json(
      { code: error.code, error: error.code, message: error.message },
      error.status,
    );
  return json(
    {
      code: "service_unavailable",
      error: "service_unavailable",
      message:
        "This service is unavailable. Your local measurement is unaffected.",
    },
    503,
  );
}

export function requireMethod(request: Request, method: string) {
  if (request.method !== method)
    throw new HttpError(
      405,
      "method_not_allowed",
      `Use ${method} for this request.`,
    );
}

export function requireSameOrigin(request: Request, appOrigin = "") {
  const origin = request.headers.get("origin");
  const expected = appOrigin || new URL(request.url).origin;
  if (!origin || origin !== expected)
    throw new HttpError(
      403,
      "origin_rejected",
      "Open this feature from the NeuroFront dashboard.",
    );
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site))
    throw new HttpError(
      403,
      "origin_rejected",
      "Cross-site requests are not allowed.",
    );
}

export async function readJson(
  request: Request,
  maxBytes = 32_768,
): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new HttpError(415, "json_required", "Send JSON for this request.");
  }
  if (Number(request.headers.get("content-length")) > maxBytes) {
    throw new HttpError(
      413,
      "request_too_large",
      "This request contains too much content.",
    );
  }
  const reader = request.body?.getReader();
  if (!reader)
    throw new HttpError(400, "empty_request", "The request is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(
          413,
          "request_too_large",
          "This request contains too much content.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "invalid_json", "The request is not valid JSON.");
  }
}
