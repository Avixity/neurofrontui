import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { assistantHandler } from "./handlers";
import { readConfig } from "./config";
import { projectKnowledge } from "./knowledge";
import type { AssistantContext } from "./contracts";

const mock = vi.hoisted(() => ({
  verified: vi.fn(),
  quota: vi.fn(),
  generate: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock("./supabase", () => ({
  verifiedAccount: mock.verified,
  serviceClient: () => ({ rpc: mock.quota }),
}));
vi.mock("ai", () => ({ streamText: mock.generate }));
const config = {
  ...readConfig({}),
  supabaseUrl: "https://test.supabase.co",
  publicKey: "public",
  serviceKey: "server",
  model: "test/model",
  gatewayReady: true,
  signingSecret: "test-secret-at-least-thirty-two-characters",
};
const features = {
  mean: 98765,
  rms: 98765,
  stdDev: 1,
  peakToPeak: 2,
  derivativeMean: 1,
};
const context: AssistantContext = {
  source: "simulated",
  sampleCount: 20,
  durationMs: 15000,
  score: 92,
  status: "completed",
  quality: "limited",
  features,
  baselineFeatures: features,
  baselineSampleCount: 30,
  temperatureSamples: 0,
  gsrSamples: 0,
};
function request(extra: Record<string, unknown> = {}) {
  return new Request("http://localhost:5180/api/assistant", {
    method: "POST",
    headers: {
      Origin: "http://localhost:5180",
      "Content-Type": "application/json",
      Authorization: "Bearer test.jwt.token",
    },
    body: JSON.stringify({
      requestId: randomUUID(),
      language: "en",
      messages: [{ role: "user", content: "Explain this measurement." }],
      ...extra,
    }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.quota.mockResolvedValue({ data: { allowed: true }, error: null });
  mock.verified.mockResolvedValue({
    user: { id: "verified-owner" },
    client: { from: mock.from },
  });
  mock.from.mockReturnValue({ select: mock.select });
  mock.select.mockReturnValue({ eq: mock.eq });
  mock.eq.mockReturnValue({ maybeSingle: mock.lookup });
  mock.lookup.mockResolvedValue({ data: null, error: null });
  mock.generate.mockImplementation(() => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-delta", text: "A test stream." });
        controller.close();
      },
    }),
  }));
});

describe("assistant account context and stream boundaries", () => {
  it("discards signed-in client summaries and uses bounded verified project knowledge", async () => {
    const response = await assistantHandler(request({ context }), config);
    expect(await response.text()).toContain("A test stream.");
    const options = mock.generate.mock.calls[0][0];
    expect(options.instructions).toContain("Measurement context: null");
    expect(options.instructions).not.toContain("98765");
    expect(options.instructions).toContain("personal-baseline");
    expect(options.instructions).toContain("Do not use em dashes");
    expect(options).toMatchObject({
      maxOutputTokens: 800,
      maxRetries: 0,
      timeout: { totalMs: 40000 },
    });
    expect(projectKnowledge.length).toBeLessThan(24000);
    expect(JSON.parse(projectKnowledge).articles).toHaveLength(9);
  });
  it("loads a selected record through the verified account client and ignores supplied values", async () => {
    const measurementId = randomUUID();
    const savedFeatures = {
      mean: 11,
      rms: 11,
      stdDev: 2,
      peakToPeak: 4,
      derivativeMean: 1,
    };
    mock.lookup.mockResolvedValue({
      data: {
        snapshot: {
          device: { source: "bluetooth" },
          sampleCount: 300,
          durationMs: 15000,
          score: 25,
          status: "completed",
          quality: { status: "good" },
          features: savedFeatures,
          traces: { temperature: [], gsr: [] },
        },
        baseline_snapshot: { features: savedFeatures, sampleCount: 400 },
      },
      error: null,
    });
    const response = await assistantHandler(
      request({ measurementId, context }),
      config,
    );
    await response.text();
    expect(mock.from).toHaveBeenCalledWith("measurements");
    expect(mock.eq).toHaveBeenCalledWith("id", measurementId);
    expect(mock.generate.mock.calls[0][0].instructions).toContain('"score":25');
    expect(mock.generate.mock.calls[0][0].instructions).not.toContain("98765");
    expect(mock.generate.mock.calls[0][0].instructions).toContain(
      "saved snapshot retrieved using verified account access",
    );
  });
  it("does not call the model when an account cannot access the selected record", async () => {
    await expect(
      assistantHandler(request({ measurementId: randomUUID() }), config),
    ).rejects.toMatchObject({ code: "measurement_not_found", status: 404 });
    expect(mock.generate).not.toHaveBeenCalled();
    expect(mock.quota).not.toHaveBeenCalled();
  });
  it("exposes stream failure without provider internals or a false completion event", async () => {
    mock.generate.mockImplementation(() => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "error",
            error: new Error("private-provider-details"),
          });
          controller.close();
        },
      }),
    }));
    const response = await assistantHandler(request(), config);
    const body = await response.text();
    expect(body).toContain("assistant_failed");
    expect(body).not.toContain("private-provider-details");
    expect(body).not.toContain('"done"');
  });
});
