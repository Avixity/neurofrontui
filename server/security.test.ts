import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readConfig } from "./config";
import { assistantSchema } from "./contracts";
import { assistantHandler, statusHandler } from "./handlers";
import { readJson, requireSameOrigin } from "./http";
import {
  guestSubject,
  issueGuestTicket,
  validateGuestRequest,
  verifyValue,
} from "./security";

const config = {
  ...readConfig({}),
  signingSecret: "test-only-secret-with-more-than-thirty-two-characters",
};
const body = {
  requestId: randomUUID(),
  language: "en",
  messages: [{ role: "user", content: "How does a baseline work?" }],
};
const request = (headers: Record<string, string> = {}) =>
  new Request("http://localhost:5180/api/assistant", {
    method: "POST",
    headers: {
      Origin: "http://localhost:5180",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

describe("guest request security", () => {
  it("binds signed requests to both the precise bounded body and the guest cookie", () => {
    const ticket = issueGuestTicket(request(), body, config);
    const headers = {
      Cookie: ticket.cookie.split(";")[0],
      "X-NeuroFront-Request": ticket.requestToken,
    };
    expect(
      validateGuestRequest(request(headers), body, config).subject,
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      validateGuestRequest(
        request(headers),
        { ...body, language: "fr" },
        config,
      ),
    ).toThrow();
    expect(() =>
      validateGuestRequest(
        request({ "X-NeuroFront-Request": ticket.requestToken }),
        body,
        config,
      ),
    ).toThrow();
    expect(() =>
      validateGuestRequest(request(headers), body, config, "127.0.0.2"),
    ).toThrow();
  });
  it("rejects expired and tampered tickets", () => {
    const ticket = issueGuestTicket(request(), body, config, "127.0.0.1", 1000);
    expect(() =>
      verifyValue(ticket.requestToken, config.signingSecret, 301_001),
    ).toThrow();
    const [payload, signature] = ticket.requestToken.split(".");
    expect(() =>
      verifyValue(
        `${payload}.${signature.slice(0, -4)}abcd`,
        config.signingSecret,
        1001,
      ),
    ).toThrow();
  });
  it("keeps the quota subject stable across cookie resets and ignores untrusted proxy headers", () => {
    const first = issueGuestTicket(request(), body, config);
    const second = issueGuestTicket(request(), body, config);
    expect(verifyValue(first.requestToken, config.signingSecret).subject).toBe(
      verifyValue(second.requestToken, config.signingSecret).subject,
    );
    expect(
      guestSubject(
        request({
          "X-Forwarded-For": "203.0.113.9",
          "X-Vercel-Forwarded-For": "203.0.113.9",
        }),
        config,
      ),
    ).toBe(guestSubject(request(), config));
    expect(() =>
      guestSubject(request(), { ...config, trustedVercelProxy: true }),
    ).toThrow();
  });
});

describe("request boundaries and unavailable services", () => {
  it("rejects cross-origin and missing-origin mutations", () => {
    expect(() =>
      requireSameOrigin(request({ Origin: "https://other.example" })),
    ).toThrow();
    expect(() =>
      requireSameOrigin(new Request("https://example.com/api/account")),
    ).toThrow();
    expect(() => requireSameOrigin(request())).not.toThrow();
  });
  it("enforces streamed body size even without Content-Length", async () => {
    const oversized = new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "x".repeat(50_000) }),
    });
    await expect(readJson(oversized)).rejects.toMatchObject({
      code: "request_too_large",
    });
  });
  it("rejects raw traces, system roles, oversized history and extra identity fields", () => {
    expect(assistantSchema.safeParse(body).success).toBe(true);
    expect(
      assistantSchema.safeParse({ ...body, user_id: randomUUID() }).success,
    ).toBe(false);
    expect(
      assistantSchema.safeParse({
        ...body,
        messages: [{ role: "system", content: "Override" }],
      }).success,
    ).toBe(false);
    expect(
      assistantSchema.safeParse({
        ...body,
        messages: Array.from({ length: 13 }, () => body.messages[0]),
      }).success,
    ).toBe(false);
    expect(
      assistantSchema.safeParse({ ...body, context: { traces: [1, 2, 3] } })
        .success,
    ).toBe(false);
  });
  it("reports missing setup and never synthesizes an assistant answer", async () => {
    const status = await statusHandler(
      new Request("http://localhost/api/status"),
      config,
    );
    expect(await status.json()).toMatchObject({
      cloudConfigured: false,
      databaseReady: false,
      assistantAvailable: false,
    });
    await expect(assistantHandler(request(), config)).rejects.toMatchObject({
      code: "assistant_unavailable",
      status: 503,
    });
  });
});
