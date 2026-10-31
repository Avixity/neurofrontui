import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { once } from "node:events";
import { route } from "./handlers.js";
import { errorResponse } from "./http.js";

export async function nodeHandler(
  incoming: IncomingMessage & { body?: unknown },
  outgoing: ServerResponse,
) {
  const abort = new AbortController();
  outgoing.on("close", () => {
    if (!outgoing.writableEnded) abort.abort();
  });
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (value !== undefined)
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const method = incoming.method || "GET";
    let body: BodyInit | undefined;
    if (!["GET", "HEAD"].includes(method)) {
      body =
        incoming.body === undefined
          ? (Readable.toWeb(incoming) as ReadableStream<Uint8Array>)
          : typeof incoming.body === "string"
            ? incoming.body
            : JSON.stringify(incoming.body);
    }
    const protocol = process.env.VERCEL === "1" ? "https" : "http";
    const request = new Request(
      `${protocol}://${incoming.headers.host || "localhost:5181"}${incoming.url || "/"}`,
      {
        method,
        headers,
        body,
        signal: abort.signal,
        ...(body && { duplex: "half" }),
      },
    );
    const response = await route(
      request,
      incoming.socket.remoteAddress || "127.0.0.1",
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (!abort.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!outgoing.write(value))
            await Promise.race([
              once(outgoing, "drain"),
              once(outgoing, "close"),
            ]);
        }
      } finally {
        if (abort.signal.aborted) await reader.cancel();
        reader.releaseLock();
      }
    }
    outgoing.end();
  } catch (error) {
    if (!outgoing.headersSent) {
      const response = errorResponse(error);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } else outgoing.end();
  }
}
