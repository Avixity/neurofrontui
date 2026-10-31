import {
  emptyTraces,
  type Baseline,
  type DeviceInfo,
  type Features,
  type Measurement,
  type Quality,
  type Sample,
  type Traces,
} from "../types";
import {
  ACQUISITION_VERSION,
  ALGORITHM_VERSION,
  SCHEMA_VERSION,
  calculateScore,
  computeSignalFeatures,
} from "./calculation";
import type { ReceivedSample } from "./device";

export {
  ACQUISITION_VERSION,
  ALGORITHM_VERSION,
  SCHEMA_VERSION,
} from "./calculation";
export const BASELINE_MS = 20_000;
export const CAPTURE_MS = 15_000;
export const SIGNAL_TIMEOUT_MS = 5_000;
export const MIN_COVERAGE = 0.8;
export const MAX_RECORDING_SAMPLES = 20_000;
export const LIVE_BUFFER_SIZE = 1_200;
export const CHANNEL_UNITS = Object.freeze({
  primary: "device units",
  temperature: "°C",
  gsr: "µS",
});

export type AcquisitionIssue =
  | "noData"
  | "signalLost"
  | "hidden"
  | "disconnected"
  | "short"
  | "flat"
  | "cancelled"
  | "incompatible"
  | "bufferLimit";
export type AcquisitionPhase =
  "idle" | "baseline" | "ready" | "capture" | "complete" | "interrupted";
export type AcquisitionSnapshot = {
  revision: number;
  phase: AcquisitionPhase;
  connected: boolean;
  device: DeviceInfo | null;
  baseline: Baseline | null;
  baselineCompatible: boolean;
  result: Measurement | null;
  issue: AcquisitionIssue | null;
  elapsedMs: number;
  remainingMs: number;
  durationMs: number;
  progress: number;
  sampleCount: number;
  invalidPackets: number;
  latestSample: Sample | null;
  signalFresh: boolean;
  quality: Quality;
};
export type AcquisitionOptions = {
  now?: () => number;
  wallNow?: () => number;
  makeId?: () => string;
  autoTick?: boolean;
  onChange?: () => void;
  onComplete?: (measurement: Measurement) => void;
  onBaseline?: (baseline: Baseline) => void;
};

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const clone = <T>(value: T): T => structuredClone(value);
const featuresFinite = (features: Features) =>
  ["mean", "rms", "stdDev", "peakToPeak", "derivativeMean"].every((key) =>
    Number.isFinite(features?.[key as keyof Features]),
  );

export function compatible(
  baseline: Baseline | null,
  device: DeviceInfo | null,
): boolean {
  if (!baseline || !device || !baseline.device) return false;
  const prior = baseline.device;
  return (
    baseline.algorithmVersion === ALGORITHM_VERSION &&
    baseline.acquisitionVersion === ACQUISITION_VERSION &&
    baseline.schemaVersion === SCHEMA_VERSION &&
    baseline.units?.primary === CHANNEL_UNITS.primary &&
    featuresFinite(baseline.features) &&
    prior.source === device.source &&
    prior.protocol === device.protocol &&
    prior.setup === device.setup &&
    prior.timestampSource === device.timestampSource &&
    prior.serviceUuid?.toLowerCase() === device.serviceUuid?.toLowerCase() &&
    prior.characteristicUuid?.toLowerCase() ===
      device.characteristicUuid?.toLowerCase() &&
    (prior.id || device.id
      ? prior.id === device.id
      : prior.name === device.name)
  );
}

export function isValidBaseline(baseline: Baseline): boolean {
  if (
    !baseline?.id ||
    !Number.isFinite(Date.parse(baseline.createdAt)) ||
    baseline.durationMs !== BASELINE_MS ||
    !featuresFinite(baseline.features) ||
    !baseline.traces?.primary ||
    !baseline.quality ||
    baseline.sampleCount < 2 ||
    baseline.sampleCount > MAX_RECORDING_SAMPLES ||
    baseline.sampleCount !== baseline.traces.primary.length ||
    !compatible(baseline, baseline.device)
  )
    return false;
  let previous = 0,
    maxGap = 0;
  for (const sample of baseline.traces.primary) {
    if (
      ![sample.t, sample.timestamp, sample.value].every(Number.isFinite) ||
      sample.t < previous ||
      sample.t < 0 ||
      sample.t > baseline.durationMs
    )
      return false;
    maxGap = Math.max(maxGap, sample.t - previous);
    previous = sample.t;
  }
  maxGap = Math.max(maxGap, baseline.durationMs - previous);
  if (
    maxGap >= SIGNAL_TIMEOUT_MS ||
    previous - baseline.traces.primary[0].t < BASELINE_MS * MIN_COVERAGE
  )
    return false;
  const features = computeSignalFeatures(
    baseline.traces.primary.map((sample) => sample.value),
  );
  return (Object.keys(features) as (keyof Features)[]).every(
    (key) =>
      Math.abs(features[key] - baseline.features[key]) <=
      1e-10 * Math.max(1, Math.abs(features[key])),
  );
}

class RecentSamples {
  private values: Sample[] = [];
  private offset = 0;
  push(sample: Sample) {
    if (this.values.length < LIVE_BUFFER_SIZE) this.values.push(sample);
    else {
      this.values[this.offset] = sample;
      this.offset = (this.offset + 1) % LIVE_BUFFER_SIZE;
    }
  }
  read(): Sample[] {
    return this.offset
      ? [
          ...this.values.slice(this.offset),
          ...this.values.slice(0, this.offset),
        ]
      : this.values.slice();
  }
  clear() {
    this.values = [];
    this.offset = 0;
  }
}

type ActiveWindow = {
  kind: "baseline" | "capture";
  startedAt: number;
  startedEpoch: number;
  durationMs: number;
  device: DeviceInfo;
  baseline: Baseline | null;
  samples: Sample[];
  invalidPackets: number;
  maxGapMs: number;
  lastValidAt: number | null;
};

export function createAcquisition(options: AcquisitionOptions = {}) {
  const now = options.now ?? (() => performance.now());
  const wallNow = options.wallNow ?? Date.now;
  const makeId = options.makeId ?? (() => crypto.randomUUID());
  const recent = new RecentSamples();
  const listeners = new Set<() => void>();
  let connected = false,
    disposed = false,
    dirty = false;
  let device: DeviceInfo | null = null,
    baseline: Baseline | null = null,
    result: Measurement | null = null;
  let phase: AcquisitionPhase = "idle",
    issue: AcquisitionIssue | null = null;
  let active: ActiveWindow | null = null;
  let latestSample: Sample | null = null,
    lastReceivedAt: number | null = null,
    liveStartedAt = now();
  let elapsedMs = 0,
    durationMs = 0,
    revision = 0,
    lastPublishAt = -Infinity;
  let quality: Quality = freeze({
    status: "limited",
    issues: [],
    validSamples: 0,
    invalidPackets: 0,
    maxGapMs: 0,
  });
  let timer: ReturnType<typeof setInterval> | null = null;

  function fresh(time: number) {
    return (
      connected &&
      lastReceivedAt !== null &&
      time - lastReceivedAt < SIGNAL_TIMEOUT_MS
    );
  }
  function buildSnapshot(time: number): AcquisitionSnapshot {
    const elapsed = active
      ? Math.max(0, Math.min(active.durationMs, time - active.startedAt))
      : elapsedMs;
    const duration = active?.durationMs ?? durationMs;
    return Object.freeze({
      revision: ++revision,
      phase,
      connected,
      device,
      baseline,
      baselineCompatible: compatible(baseline, device),
      result,
      issue,
      elapsedMs: elapsed,
      remainingMs: active ? Math.max(0, duration - elapsed) : 0,
      durationMs: duration,
      progress: duration ? Math.min(1, elapsed / duration) : 0,
      sampleCount: active?.samples.length ?? quality.validSamples,
      invalidPackets: active?.invalidPackets ?? quality.invalidPackets,
      latestSample,
      signalFresh: fresh(time),
      quality: active
        ? (freeze({
            status: "limited",
            issues: [],
            validSamples: active.samples.length,
            invalidPackets: active.invalidPackets,
            maxGapMs: active.maxGapMs,
          }) as Quality)
        : quality,
    });
  }
  let snapshot = buildSnapshot(now());
  function publish(time = now(), force = false) {
    if (disposed || (!force && time - lastPublishAt < 100)) return;
    if (!force && !dirty && !active && snapshot.signalFresh === fresh(time))
      return;
    lastPublishAt = time;
    dirty = false;
    snapshot = buildSnapshot(time);
    options.onChange?.();
    listeners.forEach((listener) => listener());
  }
  function startTimer() {
    if (options.autoTick !== false && !timer && !disposed)
      timer = setInterval(() => tick(), 100);
  }
  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function assess(
    window: ActiveWindow,
    duration: number,
    reason?: AcquisitionIssue,
  ): Quality {
    const samples = window.samples;
    const maxGapMs = Math.max(
      window.maxGapMs,
      duration - (samples.at(-1)?.t ?? 0),
    );
    const issues: AcquisitionIssue[] = reason ? [reason] : [];
    if (!samples.length) issues.push("noData");
    else {
      if (
        samples.length < 2 ||
        samples.at(-1)!.t - samples[0].t < window.durationMs * MIN_COVERAGE
      )
        issues.push("short");
      if (maxGapMs >= SIGNAL_TIMEOUT_MS) issues.push("signalLost");
      if (samples.every((sample) => sample.value === samples[0].value))
        issues.push("flat");
    }
    const unique = [...new Set(issues)];
    return freeze({
      status: unique.length
        ? "poor"
        : window.invalidPackets || maxGapMs > 1_000
          ? "limited"
          : "good",
      issues: unique,
      validSamples: samples.length,
      invalidPackets: window.invalidPackets,
      maxGapMs,
    });
  }
  function finish(time: number, reason?: AcquisitionIssue) {
    if (!active) return;
    const completed = active;
    active = null;
    elapsedMs = Math.max(
      0,
      Math.min(completed.durationMs, time - completed.startedAt),
    );
    durationMs = completed.durationMs;
    quality = assess(completed, elapsedMs, reason);
    const fatal = quality.issues.find((value) => value !== "flat") as
      AcquisitionIssue | undefined;
    issue =
      reason ?? fatal ?? (quality.issues.includes("flat") ? "flat" : null);
    const features = computeSignalFeatures(
      completed.samples.map((sample) => sample.value),
    );
    const traces: Traces = {
      primary: completed.samples.slice(),
      temperature: [],
      gsr: [],
    };
    const metadata = {
      id: makeId(),
      createdAt: new Date(completed.startedEpoch).toISOString(),
      durationMs: elapsedMs,
      sampleCount: completed.samples.length,
      traces,
      units: { ...CHANNEL_UNITS },
      features,
      quality,
      device: clone(completed.device),
      algorithmVersion: ALGORITHM_VERSION,
      acquisitionVersion: ACQUISITION_VERSION,
      schemaVersion: SCHEMA_VERSION,
    };
    if (completed.kind === "baseline") {
      if (!fatal && !reason) {
        baseline = freeze(metadata);
        phase = "ready";
        options.onBaseline?.(baseline);
      } else phase = "interrupted";
    } else {
      result = freeze({
        ...metadata,
        baselineId: completed.baseline!.id,
        baseline: clone(completed.baseline!),
        score:
          fatal || reason
            ? null
            : calculateScore(features, completed.baseline!.features),
        status: fatal || reason ? "interrupted" : "completed",
        notes: "",
        tags: [],
      });
      phase = result.status === "completed" ? "complete" : "interrupted";
      options.onComplete?.(result);
    }
    publish(time, true);
  }
  function advance(time: number) {
    if (!active) return;
    const deadline = active.startedAt + active.durationMs;
    if (time >= deadline) {
      finish(deadline);
      return;
    }
    if (time - (active.lastValidAt ?? active.startedAt) >= SIGNAL_TIMEOUT_MS)
      finish(time, active.lastValidAt === null ? "noData" : "signalLost");
  }
  function tick(time = now()) {
    if (disposed || !Number.isFinite(time)) return;
    advance(time);
    publish(time);
  }
  function interrupt(reason: AcquisitionIssue, time = now()) {
    if (active) finish(time, reason);
  }
  function connect(info: DeviceInfo) {
    if (disposed) return;
    if (active) interrupt("disconnected");
    connected = true;
    device = freeze(clone(info));
    recent.clear();
    latestSample = null;
    lastReceivedAt = null;
    liveStartedAt = now();
    phase = compatible(baseline, device) ? "ready" : "idle";
    issue = baseline && !compatible(baseline, device) ? "incompatible" : null;
    startTimer();
    publish(now(), true);
  }
  function disconnect() {
    if (disposed) return;
    connected = false;
    interrupt("disconnected");
    stopTimer();
    publish(now(), true);
  }
  function setBaseline(value: Baseline | null): boolean {
    if (disposed || active) return false;
    if (
      value &&
      (!isValidBaseline(value) || (device && !compatible(value, device)))
    ) {
      issue = "incompatible";
      publish(now(), true);
      return false;
    }
    baseline = value ? freeze(clone(value)) : null;
    issue = null;
    phase = baseline ? "ready" : "idle";
    publish(now(), true);
    return true;
  }
  function start(kind: ActiveWindow["kind"]): boolean {
    if (disposed || active) return false;
    if (!connected || !device) {
      issue = "disconnected";
      publish(now(), true);
      return false;
    }
    if (kind === "capture" && !compatible(baseline, device)) {
      issue = "incompatible";
      publish(now(), true);
      return false;
    }
    const startTime = now();
    active = {
      kind,
      startedAt: startTime,
      startedEpoch: wallNow(),
      durationMs: kind === "baseline" ? BASELINE_MS : CAPTURE_MS,
      device: clone(device),
      baseline: kind === "capture" ? clone(baseline!) : null,
      samples: [],
      invalidPackets: 0,
      maxGapMs: 0,
      lastValidAt: null,
    };
    result = null;
    phase = kind;
    issue = null;
    elapsedMs = 0;
    durationMs = active.durationMs;
    startTimer();
    publish(startTime, true);
    return true;
  }
  function invalidPacket() {
    if (active) active.invalidPackets += 1;
    dirty = true;
  }
  function acceptSample(sample: ReceivedSample) {
    if (disposed || !connected) return;
    if (
      ![sample.value, sample.receivedAt, sample.timestamp].every(
        Number.isFinite,
      ) ||
      (lastReceivedAt !== null && sample.receivedAt < lastReceivedAt)
    ) {
      invalidPacket();
      return;
    }
    advance(sample.receivedAt);
    lastReceivedAt = sample.receivedAt;
    latestSample = freeze({
      t: Math.max(0, sample.receivedAt - liveStartedAt),
      timestamp: sample.timestamp,
      value: sample.value,
    });
    recent.push(latestSample);
    if (active && sample.receivedAt >= active.startedAt) {
      if (active.samples.length >= MAX_RECORDING_SAMPLES) {
        finish(sample.receivedAt, "bufferLimit");
        return;
      }
      active.maxGapMs = Math.max(
        active.maxGapMs,
        sample.receivedAt - (active.lastValidAt ?? active.startedAt),
      );
      active.lastValidAt = sample.receivedAt;
      active.samples.push(
        freeze({
          t: sample.receivedAt - active.startedAt,
          timestamp: sample.timestamp,
          value: sample.value,
        }),
      );
    }
    dirty = true;
  }
  return {
    connect,
    disconnect,
    setBaseline,
    acceptSample,
    invalidPacket,
    tick,
    interrupt,
    startBaseline(info?: DeviceInfo) {
      if (info) connect(info);
      return start("baseline");
    },
    startCapture: () => start("capture"),
    cancel: () => interrupt("cancelled"),
    reset() {
      if (active) interrupt("cancelled");
      result = null;
      issue = null;
      elapsedMs = durationMs = 0;
      quality = freeze({
        status: "limited",
        issues: [],
        validSamples: 0,
        invalidPackets: 0,
        maxGapMs: 0,
      });
      phase = compatible(baseline, device) ? "ready" : "idle";
      publish(now(), true);
    },
    clearSession() {
      if (disposed) return;
      connected = false;
      interrupt("disconnected");
      stopTimer();
      device = null;
      baseline = null;
      result = null;
      latestSample = null;
      lastReceivedAt = null;
      recent.clear();
      liveStartedAt = now();
      elapsedMs = durationMs = 0;
      phase = "idle";
      issue = null;
      quality = freeze({
        status: "limited",
        issues: [],
        validSamples: 0,
        invalidPackets: 0,
        maxGapMs: 0,
      });
      publish(now(), true);
    },
    getSnapshot: () => snapshot,
    getTraces(): Traces {
      if (active)
        return { primary: active.samples.slice(), temperature: [], gsr: [] };
      if (result && (phase === "complete" || phase === "interrupted"))
        return result.traces;
      return { ...emptyTraces(), primary: recent.read() };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      interrupt("hidden");
      stopTimer();
      listeners.clear();
      disposed = true;
    },
  };
}

export type AcquisitionController = ReturnType<typeof createAcquisition>;
