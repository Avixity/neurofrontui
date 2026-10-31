import type { Measurement } from "../types";
import type { AssistantInput, AssistantContext } from "../../server/contracts";
import { CloudError, getSession } from "./auth";

export type { AssistantContext };
export type AssistantRequest = Omit<AssistantInput, "requestId">;
export function measurementContext(measurement: Measurement): AssistantContext {
  return {
    source: measurement.device.source,
    sampleCount: measurement.sampleCount,
    durationMs: measurement.durationMs,
    score: measurement.score,
    status: measurement.status,
    quality: measurement.quality.status,
    features: measurement.features,
    baselineFeatures: measurement.baseline.features,
    baselineSampleCount: measurement.baseline.sampleCount,
    temperatureSamples: measurement.traces.temperature.length,
    gsrSamples: measurement.traces.gsr.length,
  };
}
export async function getAssistantStatus() {
  const response = await fetch("/api/status", { cache: "no-store" });
  if (!response.ok)
    throw new CloudError(
      "assistant_unavailable",
      "The assistant is unavailable.",
    );
  return response.json() as Promise<{
    cloudConfigured: boolean;
    databaseReady: boolean;
    assistantAvailable: boolean;
    reason: string | null;
  }>;
}
async function requireOk(response: Response) {
  if (response.ok) return;
  const result = await response.json().catch(() => ({}));
  throw new CloudError(
    result.code || "assistant_failed",
    result.message || "The assistant request did not finish.",
  );
}
export async function streamAssistant(
  input: AssistantRequest,
  options: { signal?: AbortSignal; onChunk: (text: string) => void },
) {
  const session = await getSession();
  const body = JSON.stringify({ ...input, requestId: crypto.randomUUID() });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session) headers.Authorization = `Bearer ${session.access_token}`;
  else {
    const ticket = await fetch("/api/assistant-session", {
      method: "POST",
      headers,
      body,
      signal: options.signal,
    });
    await requireOk(ticket);
    headers["X-NeuroFront-Request"] = (await ticket.json()).requestToken;
  }
  const response = await fetch("/api/assistant", {
    method: "POST",
    headers,
    body,
    signal: options.signal,
  });
  await requireOk(response);
  if (!response.body)
    throw new CloudError(
      "assistant_failed",
      "The assistant returned no response.",
    );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let completed = false;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        const line = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6)) as {
          type: string;
          text?: string;
          code?: string;
        };
        if (event.type === "error")
          throw new CloudError(
            event.code || "assistant_failed",
            "The assistant could not complete this reply.",
          );
        if (event.type === "done") completed = true;
        if (event.type === "delta" && event.text) {
          text += event.text;
          options.onChunk(event.text);
        }
      }
      if (pending.length > 32_768 || text.length > 32_768)
        throw new CloudError(
          "assistant_failed",
          "The assistant response exceeded the limit.",
        );
    }
    if (!completed || !text.trim())
      throw new CloudError(
        "assistant_failed",
        "The assistant could not complete this reply.",
      );
    return text;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
