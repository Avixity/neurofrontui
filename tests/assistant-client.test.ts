import { afterEach, describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({
  value: null as null | { access_token: string },
}));
vi.mock("../src/services/auth", () => ({
  getSession: async () => session.value,
  CloudError: class extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
import { streamAssistant } from "../src/services/assistant";
const input = {
  messages: [{ role: "user" as const, content: "Help me calibrate." }],
  language: "en" as const,
};
afterEach(() => {
  session.value = null;
  vi.unstubAllGlobals();
});
function sse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        chunks.forEach((text) => controller.enqueue(encoder.encode(text)));
        controller.close();
      },
    }),
  );
}
describe("assistant client transport with simulated service responses", () => {
  it("streams split events without inventing a complete response and obtains a guest ticket", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ requestToken: "signed-guest-ticket" }),
      )
      .mockResolvedValueOnce(
        sse([
          'data: {"type":"del',
          'ta","text":"Take a "}\n\n',
          'data: {"type":"delta","text":"resting reference."}\n\n',
          'data: {"type":"done"}\n\n',
        ]),
      );
    vi.stubGlobal("fetch", fetch);
    const chunks: string[] = [];
    expect(
      await streamAssistant(input, { onChunk: (text) => chunks.push(text) }),
    ).toBe("Take a resting reference.");
    expect(chunks).toEqual(["Take a ", "resting reference."]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const request = fetch.mock.calls[1][1];
    expect(request.headers["X-NeuroFront-Request"]).toBe("signed-guest-ticket");
    expect(request.headers.Authorization).toBeUndefined();
    expect(JSON.parse(request.body).context).toBeUndefined();
  });
  it("uses the initiating authenticated token and only the selected record ID", async () => {
    session.value = { access_token: "initiating-account-token" };
    const fetch = vi
      .fn()
      .mockResolvedValue(
        sse([
          'data: {"type":"delta","text":"A selected session."}\n\ndata: {"type":"done"}\n\n',
        ]),
      );
    vi.stubGlobal("fetch", fetch);
    await streamAssistant(
      { ...input, measurementId: "00000000-0000-4000-8000-000000000001" },
      { onChunk: () => {} },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer initiating-account-token",
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty(
      "user_id",
    );
  });
  it("rejects a partial stream without done, and explicit server errors", async () => {
    session.value = { access_token: "test-token" };
    for (const text of [
      'data: {"type":"delta","text":"Partial"}\n\n',
      'data: {"type":"error","code":"assistant_failed"}\n\n',
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([text])));
      await expect(
        streamAssistant(input, { onChunk: () => {} }),
      ).rejects.toMatchObject({ code: "assistant_failed" });
    }
  });
  it("preserves a rate-limit error and forwards cancellation to the request", async () => {
    session.value = { access_token: "test-token" };
    const controller = new AbortController();
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { code: "rate_limited", message: "Try later" },
          { status: 429 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      streamAssistant(input, { signal: controller.signal, onChunk: () => {} }),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
  });
});
