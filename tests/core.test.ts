import { describe, expect, it, vi } from "vitest";
import fixtures from "../legacy/calculation-fixtures.json";
import type { Baseline, DeviceInfo } from "../src/types";
import {
  calculateScore,
  compositeActivity,
  computeSignalFeatures,
  scoreBand,
  summarizeActivity,
} from "../src/core/calculation";
import {
  BASELINE_MS,
  CAPTURE_MS,
  LIVE_BUFFER_SIZE,
  MAX_RECORDING_SAMPLES,
  compatible,
  createAcquisition,
  isValidBaseline,
} from "../src/core/acquisition";
import {
  CHARACTERISTIC_UUID,
  DEVICE_SETUP,
  PROTOCOL_VERSION,
  REQUEST_OPTIONS,
  SERVICE_UUID,
  createDeviceClient,
  parseNotification,
  type BluetoothAdapter,
  type BluetoothCharacteristic,
  type BluetoothDevice,
  type BluetoothServer,
  type ReceivedSample,
} from "../src/core/device";
import { makeSimulatedBluetooth } from "../src/core/simulator";

// Every peripheral and notification in this file is simulated. No radio is used.
const info: DeviceInfo = {
  name: "NeuroFront",
  id: "fake-peripheral",
  serviceUuid: SERVICE_UUID,
  characteristicUuid: CHARACTERISTIC_UUID,
  protocol: PROTOCOL_VERSION,
  setup: DEVICE_SETUP,
  timestampSource: "browser-receipt",
  source: "bluetooth",
};
const data = (value: string) =>
  new DataView(new TextEncoder().encode(value).buffer);

class FakeCharacteristic
  extends EventTarget
  implements BluetoothCharacteristic
{
  value?: DataView;
  startNotifications = vi.fn(async () => this);
  notify(value: string) {
    this.value = data(value);
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
}
function peripheral() {
  const characteristic = new FakeCharacteristic();
  const getCharacteristic = vi.fn(async () => characteristic);
  const device = new EventTarget() as BluetoothDevice;
  device.name = "NeuroFront test";
  device.id = info.id;
  const server: BluetoothServer = {
    connected: false,
    connect: vi.fn(async () => {
      server.connected = true;
      return server;
    }),
    disconnect: vi.fn(() => {
      server.connected = false;
      device.dispatchEvent(new Event("gattserverdisconnected"));
    }),
    getPrimaryService: vi.fn(async () => ({ getCharacteristic })),
  };
  device.gatt = server;
  const adapter: BluetoothAdapter = {
    requestDevice: vi.fn(async () => device),
  };
  return { device, server, adapter, characteristic, getCharacteristic };
}
function clock() {
  let time = 0,
    ids = 0;
  const completed = vi.fn(),
    calibrated = vi.fn();
  const acq = createAcquisition({
    autoTick: false,
    now: () => time,
    wallNow: () => 1_800_000_000_000 + time,
    makeId: () => `fixture-${++ids}`,
    onComplete: completed,
    onBaseline: calibrated,
  });
  const at = (t: number) => {
    time = t;
  };
  const send = (t: number, value: number) => {
    at(t);
    acq.acceptSample({
      receivedAt: t,
      timestamp: 1_800_000_000_000 + t,
      value,
    });
  };
  const tick = (t: number) => {
    at(t);
    acq.tick(t);
  };
  const calibrate = (flat = false) => {
    acq.connect(info);
    acq.startBaseline();
    for (let t = 0; t < BASELINE_MS; t += 1_000)
      send(t, flat ? 7 : t % 2_000 === 0 ? 20 : -10);
    tick(BASELINE_MS);
    return acq.getSnapshot().baseline!;
  };
  return { acq, send, tick, at, calibrate, completed, calibrated };
}

describe("unchanged legacy calculation", () => {
  for (const fixture of fixtures.fixtures)
    it(`matches original functions: ${fixture.name}`, () => {
      const baseline = computeSignalFeatures(fixture.baseline),
        current = computeSignalFeatures(fixture.capture);
      expect(baseline).toEqual(fixture.baselineFeatures);
      expect(current).toEqual(fixture.captureFeatures);
      expect(compositeActivity(baseline)).toBe(fixture.baselineActivity);
      expect(compositeActivity(current)).toBe(fixture.captureActivity);
      expect(calculateScore(current, baseline)).toBe(fixture.score);
      expect(scoreBand(fixture.score)).toBe(fixture.label.toLowerCase());
    });
  it("keeps population statistics and empty-input behavior", () => {
    expect(computeSignalFeatures([])).toEqual({
      mean: 0,
      rms: 0,
      stdDev: 0,
      peakToPeak: 0,
      derivativeMean: 0,
    });
    expect(computeSignalFeatures([2, 4])).toEqual({
      mean: 3,
      rms: Math.sqrt(10),
      stdDev: 1,
      peakToPeak: 2,
      derivativeMean: 2,
    });
  });
  it("keeps the separate captured activity summary and category boundaries", () => {
    expect(summarizeActivity([5, 5])).toEqual({
      average: 5,
      peak: 5,
      minimum: 5,
      activity: 0,
      band: "stable",
    });
    expect(summarizeActivity([-10, 10]).band).toBe("high");
    expect([34.9, 35, 60, 78].map(scoreBand)).toEqual([
      "relaxed",
      "balanced",
      "elevated",
      "high",
    ]);
  });
});

describe("simulated BLE protocol compatibility", () => {
  it("preserves exact filters, UUID resolution, listener and notification retry", async () => {
    const fake = peripheral(),
      sleep = vi.fn(async () => {}),
      onSample = vi.fn(),
      onConnection = vi.fn();
    fake.characteristic.startNotifications.mockRejectedValueOnce(
      new Error("temporary setup failure"),
    );
    const client = createDeviceClient(
      { onSample, onConnection },
      { bluetooth: fake.adapter, now: () => 42, wallNow: () => 123456, sleep },
    );
    await client.connect();
    expect(fake.adapter.requestDevice).toHaveBeenCalledExactlyOnceWith(
      REQUEST_OPTIONS,
    );
    expect(fake.server.getPrimaryService).toHaveBeenCalledExactlyOnceWith(
      SERVICE_UUID,
    );
    expect(fake.getCharacteristic).toHaveBeenCalledExactlyOnceWith(
      CHARACTERISTIC_UUID,
    );
    expect(fake.characteristic.startNotifications).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(180);
    expect(client.getSnapshot().status).toBe("connected");
    fake.characteristic.notify("\0 12.5,36.8,9.0,1 \0");
    expect(onSample).toHaveBeenCalledExactlyOnceWith({
      value: 12.5,
      receivedAt: 42,
      timestamp: 123456,
    });
    expect(client.getSnapshot().device).toEqual({
      ...info,
      name: fake.device.name,
    });
    client.dispose();
  });
  it("keeps first-field parseFloat compatibility without inventing later channels", () => {
    expect(parseNotification(data("0,1")).value).toBe(0);
    expect(parseNotification(data("12units,99")).value).toBe(12);
    expect(parseNotification(data("  -2.4e2,garbage\0")).value).toBe(-240);
    for (const packet of ["", "NaN,32", "Infinity", "bad,12"])
      expect(parseNotification(data(packet)).value).toBeNull();
  });
  it("routes invalid packets separately, with no numeric callback", async () => {
    const fake = peripheral(),
      onSample = vi.fn(),
      onInvalidPacket = vi.fn();
    const client = createDeviceClient(
      { onSample, onInvalidPacket },
      { bluetooth: fake.adapter },
    );
    await client.connect();
    fake.characteristic.notify("bad,32");
    expect(onSample).not.toHaveBeenCalled();
    expect(onInvalidPacket).toHaveBeenCalledOnce();
    client.dispose();
  });
  it("reuses connected GATT and avoids incidental reconnection or duplicate listeners", async () => {
    const fake = peripheral(),
      onSample = vi.fn();
    fake.server.connected = true;
    const client = createDeviceClient(
      { onSample },
      { bluetooth: fake.adapter },
    );
    await Promise.all([client.connect(), client.connect()]);
    await client.connect();
    client.getSnapshot();
    expect(fake.server.connect).not.toHaveBeenCalled();
    expect(fake.adapter.requestDevice).toHaveBeenCalledOnce();
    fake.characteristic.notify("4");
    expect(onSample).toHaveBeenCalledOnce();
    client.dispose();
  });
  it("cleans up on remote disconnect without auto reconnecting", async () => {
    const fake = peripheral(),
      onSample = vi.fn(),
      onConnection = vi.fn();
    const client = createDeviceClient(
      { onSample, onConnection },
      { bluetooth: fake.adapter },
    );
    await client.connect();
    fake.server.connected = false;
    fake.device.dispatchEvent(new Event("gattserverdisconnected"));
    fake.characteristic.notify("8");
    expect(client.getSnapshot().status).toBe("disconnected");
    expect(onSample).not.toHaveBeenCalled();
    expect(fake.adapter.requestDevice).toHaveBeenCalledOnce();
    client.dispose();
  });
  it("does not connect a picker result after cancellation", async () => {
    const fake = peripheral();
    let resolve!: (device: BluetoothDevice) => void;
    fake.adapter.requestDevice = vi.fn(
      () =>
        new Promise<BluetoothDevice>((r) => {
          resolve = r;
        }),
    );
    const client = createDeviceClient({}, { bluetooth: fake.adapter });
    const connecting = client.connect();
    client.disconnect();
    resolve(fake.device);
    await connecting;
    expect(fake.server.connect).not.toHaveBeenCalled();
    expect(client.getSnapshot().status).toBe("disconnected");
    client.dispose();
  });
  it("disconnects a late GATT resolution after cancellation", async () => {
    const fake = peripheral();
    let resolve!: (server: BluetoothServer) => void;
    fake.server.connect = vi.fn(
      () =>
        new Promise<BluetoothServer>((r) => {
          resolve = r;
        }),
    );
    const client = createDeviceClient({}, { bluetooth: fake.adapter });
    const connecting = client.connect();
    await Promise.resolve();
    client.disconnect();
    fake.server.connected = true;
    resolve(fake.server);
    await connecting;
    expect(fake.server.connected).toBe(false);
    expect(fake.server.getPrimaryService).not.toHaveBeenCalled();
    client.dispose();
  });
  it("exhausts exactly two notification attempts and disconnects failed setup", async () => {
    const fake = peripheral(),
      sleep = vi.fn(async () => {});
    fake.characteristic.startNotifications.mockRejectedValue(
      new Error("setup failure"),
    );
    const client = createDeviceClient({}, { bluetooth: fake.adapter, sleep });
    await client.connect();
    expect(fake.characteristic.startNotifications).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls).toEqual([[180], [180]]);
    expect(client.getSnapshot().status).toBe("error");
    expect(fake.server.connected).toBe(false);
    client.dispose();
  });
  it("reports chooser cancellation and unavailable adapter without fake connection", async () => {
    const fake = peripheral();
    fake.adapter.requestDevice = vi.fn(async () => {
      throw new DOMException("cancel", "NotFoundError");
    });
    const client = createDeviceClient({}, { bluetooth: fake.adapter });
    await client.connect();
    expect(client.getSnapshot()).toMatchObject({
      status: "disconnected",
      error: "cancelled",
    });
    client.dispose();
    const unsupported = createDeviceClient({}, { bluetooth: null });
    await unsupported.connect();
    expect(unsupported.getSnapshot().status).toBe("unavailable");
    unsupported.dispose();
  });
});

describe("explicitly selected development peripheral", () => {
  it("is inert until connected, uses the normal parser, and is labelled simulated", async () => {
    vi.useFakeTimers();
    const simulator = makeSimulatedBluetooth();
    const onSample = vi.fn(),
      onInvalidPacket = vi.fn();
    const client = createDeviceClient(
      { onSample, onInvalidPacket },
      { bluetooth: simulator, source: simulator.source },
    );
    try {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(simulator.getStats()).toEqual({
        requests: 0,
        connections: 0,
        notifications: 0,
        running: false,
      });
      await client.connect();
      expect(client.getSnapshot().device?.source).toBe("simulated");
      expect(client.getSnapshot().device?.name).toContain("simulated");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(onSample).toHaveBeenCalledTimes(20);
      expect(
        new Set(onSample.mock.calls.map(([s]) => s.value)).size,
      ).toBeGreaterThan(5);
      simulator.setMode("invalid");
      await vi.advanceTimersByTimeAsync(100);
      expect(onInvalidPacket).toHaveBeenCalledTimes(2);
      simulator.setMode("silent");
      await vi.advanceTimersByTimeAsync(100);
      expect(onSample).toHaveBeenCalledTimes(20);
      simulator.disconnect();
      expect(client.getSnapshot().status).toBe("disconnected");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(simulator.getStats()).toEqual({
        requests: 1,
        connections: 1,
        notifications: 22,
        running: false,
      });
    } finally {
      client.dispose();
      simulator.dispose();
      vi.useRealTimers();
    }
  });

  it("exercises explicit20s baseline then15s capture through the same device client", async () => {
    vi.useFakeTimers();
    const simulator = makeSimulatedBluetooth();
    const acq = createAcquisition({ now: Date.now, wallNow: Date.now });
    const client = createDeviceClient(
      {
        onConnection: (snapshot) =>
          snapshot.device && snapshot.status === "connected"
            ? acq.connect(snapshot.device)
            : snapshot.status === "disconnected"
              ? acq.disconnect()
              : undefined,
        onSample: acq.acceptSample,
        onInvalidPacket: () => acq.invalidPacket(),
      },
      {
        bluetooth: simulator,
        source: simulator.source,
        now: Date.now,
        wallNow: Date.now,
      },
    );
    try {
      await client.connect();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(acq.getSnapshot().phase).toBe("idle");
      expect(acq.getSnapshot().baseline).toBeNull();
      expect(acq.startBaseline()).toBe(true);
      await vi.advanceTimersByTimeAsync(20_000);
      const baseline = acq.getSnapshot().baseline!;
      expect(baseline.sampleCount).toBe(399);
      expect(baseline.device.source).toBe("simulated");
      simulator.setMode("active");
      expect(acq.startCapture()).toBe(true);
      await vi.advanceTimersByTimeAsync(15_000);
      const result = acq.getSnapshot().result!;
      expect(result.status).toBe("completed");
      expect(result.sampleCount).toBe(299);
      expect(result.score).toBe(
        calculateScore(result.features, baseline.features),
      );
      expect(result.score).toBeGreaterThan(65);
      expect(result.baseline).toEqual(baseline);
    } finally {
      client.dispose();
      acq.dispose();
      simulator.dispose();
      vi.useRealTimers();
    }
  });
});

describe("timestamp acquisition with simulated notifications", () => {
  it("never starts calibration merely from connection or notifications", () => {
    const c = clock();
    c.acq.connect(info);
    c.send(0, 12);
    c.tick(20_000);
    expect(c.acq.getSnapshot().phase).toBe("idle");
    expect(c.acq.getSnapshot().baseline).toBeNull();
    expect(c.acq.getTraces().primary).toHaveLength(1);
    c.acq.dispose();
  });
  it("uses elapsed20s rather than400 notifications, preserving actual timestamps", () => {
    const c = clock();
    const baseline = c.calibrate();
    expect(baseline.durationMs).toBe(20_000);
    expect(baseline.sampleCount).toBe(20);
    expect(baseline.traces.primary[1]).toEqual({
      t: 1_000,
      timestamp: 1_800_000_001_000,
      value: -10,
    });
    expect(baseline.traces.temperature).toEqual([]);
    expect(baseline.traces.gsr).toEqual([]);
    expect(isValidBaseline(baseline)).toBe(true);
    c.acq.dispose();
  });
  it("does not finish early after400 fast notifications", () => {
    const c = clock();
    c.acq.connect(info);
    c.acq.startBaseline();
    for (let t = 0; t < 400; t++) c.send(t, t % 10);
    c.tick(400);
    expect(c.acq.getSnapshot().phase).toBe("baseline");
    expect(c.acq.getSnapshot().sampleCount).toBe(400);
    expect(c.acq.getSnapshot().baseline).toBeNull();
    c.acq.dispose();
  });
  it("records only received samples during15s, with no frame-loop duplication", () => {
    const c = clock();
    const baseline = c.calibrate();
    c.acq.startCapture();
    for (let t = 20_000; t < 35_000; t += 50) {
      if (t % 1_000 === 0) c.send(t, t % 2_000 === 0 ? 30 : -15);
      c.tick(t);
    }
    c.tick(35_000);
    const result = c.acq.getSnapshot().result!;
    expect(result.status).toBe("completed");
    expect(result.sampleCount).toBe(15);
    expect(result.durationMs).toBe(CAPTURE_MS);
    expect(result.baselineId).toBe(baseline.id);
    expect(result.score).toBe(
      calculateScore(result.features, baseline.features),
    );
    expect(c.completed).toHaveBeenCalledOnce();
    c.acq.dispose();
  });
  it("excludes notifications on or beyond the capture deadline", () => {
    const c = clock();
    c.calibrate();
    c.acq.startCapture();
    for (let t = 20_000; t < 35_000; t += 1_000) c.send(t, t);
    c.send(35_000, 999999);
    const result = c.acq.getSnapshot().result!;
    expect(result.sampleCount).toBe(15);
    expect(result.traces.primary.at(-1)!.t).toBe(14_000);
    expect(result.traces.primary.some((s) => s.value === 999999)).toBe(false);
    c.acq.dispose();
  });
  it("keeps prior baseline after cancelled or failed recalibration and disconnect", () => {
    const c = clock();
    const baseline = c.calibrate();
    c.acq.startBaseline();
    c.send(20_001, 3);
    c.acq.cancel();
    expect(c.acq.getSnapshot().baseline).toEqual(baseline);
    c.acq.startBaseline();
    c.tick(25_001);
    expect(c.acq.getSnapshot().issue).toBe("noData");
    expect(c.acq.getSnapshot().baseline).toEqual(baseline);
    c.acq.disconnect();
    expect(c.acq.getSnapshot().baseline).toEqual(baseline);
    c.acq.dispose();
  });
  it("clears a previous displayed result when recalibration starts, even if it later fails", () => {
    const c = clock();
    const baseline = c.calibrate();
    c.acq.startCapture();
    for (let t = 20_000; t < 35_000; t += 1_000) c.send(t, t % 2_000);
    c.tick(35_000);
    const previous = c.acq.getSnapshot().result!;
    expect(previous.status).toBe("completed");
    c.acq.startBaseline();
    expect(c.acq.getSnapshot().result).toBeNull();
    c.tick(40_000);
    expect(c.acq.getSnapshot()).toMatchObject({
      phase: "interrupted",
      result: null,
      baseline,
    });
    expect(c.completed).toHaveBeenCalledExactlyOnceWith(previous);
    c.acq.dispose();
  });
  it.each(["hidden", "disconnected", "cancelled"] as const)(
    "creates immutable interrupted capture for%s with no score",
    (reason) => {
      const c = clock();
      const baseline = c.calibrate();
      c.acq.startCapture();
      c.send(20_000, 3);
      c.send(21_000, 8);
      if (reason === "disconnected") c.acq.disconnect();
      else c.acq.interrupt(reason);
      const result = c.acq.getSnapshot().result!;
      expect(result.status).toBe("interrupted");
      expect(result.score).toBeNull();
      expect(result.quality.issues).toContain(reason);
      expect(result.baseline).toEqual(baseline);
      expect(result.baseline).not.toBe(baseline);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.traces.primary)).toBe(true);
      expect(Object.isFrozen(result.baseline.traces.primary[0])).toBe(true);
      c.acq.dispose();
    },
  );
  it("invalid packets cannot extend a stale numeric reading", () => {
    const c = clock();
    c.calibrate();
    c.acq.startCapture();
    c.send(20_000, 12);
    c.at(24_999);
    c.acq.invalidPacket();
    c.acq.acceptSample({
      receivedAt: 24_999,
      timestamp: 1_800_000_024_999,
      value: NaN,
    });
    c.tick(25_000);
    const result = c.acq.getSnapshot().result!;
    expect(result.score).toBeNull();
    expect(result.sampleCount).toBe(1);
    expect(result.quality.invalidPackets).toBe(2);
    expect(result.quality.issues).toContain("signalLost");
    c.acq.dispose();
  });
  it("rejects decreasing receipt times without rewriting recorded time", () => {
    const c = clock();
    c.acq.connect(info);
    c.acq.startBaseline();
    c.send(1_000, 10);
    c.send(500, 20);
    c.tick(1_001);
    expect(c.acq.getTraces().primary.map((s) => s.t)).toEqual([1_000]);
    expect(c.acq.getSnapshot().invalidPackets).toBe(1);
    c.acq.dispose();
  });
  it("rejects insufficient temporal coverage even if the end has enough samples", () => {
    const c = clock();
    c.acq.connect(info);
    c.acq.startBaseline();
    for (let t = 4_000; t < 20_000; t += 500) c.send(t, t % 1_000);
    c.tick(20_000);
    expect(c.acq.getSnapshot().baseline).toBeNull();
    expect(c.acq.getSnapshot().issue).toBe("short");
    c.acq.dispose();
  });
  it("warns on constant signals without changing the legacy score12", () => {
    const c = clock();
    const baseline = c.calibrate(true);
    expect(baseline.quality.issues).toContain("flat");
    c.acq.startCapture();
    for (let t = 20_000; t < 35_000; t += 1_000) c.send(t, 7);
    c.tick(35_000);
    expect(c.acq.getSnapshot().result).toMatchObject({
      status: "completed",
      score: 12,
    });
    c.acq.dispose();
  });
  it("keeps Bluetooth and simulated baselines, device identities and versions separate", () => {
    const c = clock();
    const baseline = c.calibrate();
    for (const change of [
      { source: "simulated" as const },
      { id: "other" },
      { setup: "other" },
      { protocol: "other" },
    ])
      expect(compatible(baseline, { ...info, ...change })).toBe(false);
    for (const change of [
      { acquisitionVersion: "old" },
      { algorithmVersion: "other" },
      { schemaVersion: 1 },
    ])
      expect(compatible({ ...baseline, ...change }, info)).toBe(false);
    c.acq.connect({ ...info, source: "simulated" });
    expect(c.acq.setBaseline(baseline)).toBe(false);
    expect(c.acq.startCapture()).toBe(false);
    expect(c.acq.getSnapshot().baseline).toEqual(baseline);
    c.acq.dispose();
  });
  it("copies selected baseline and rejects replacement during a capture", () => {
    const first = clock();
    const baseline = structuredClone(first.calibrate());
    first.acq.dispose();
    const c = clock();
    c.acq.connect(info);
    expect(c.acq.setBaseline(baseline)).toBe(true);
    baseline.traces.primary[0].value = 999;
    expect(c.acq.getSnapshot().baseline!.traces.primary[0].value).not.toBe(999);
    c.acq.startCapture();
    expect(c.acq.setBaseline(null)).toBe(false);
    c.acq.dispose();
  });
  it("bounds recent preview and fails explicitly rather than truncating a recording", () => {
    const c = clock();
    const baseline = c.calibrate();
    c.acq.reset();
    for (let i = 0; i < 5_000; i++) c.send(20_000 + i, i);
    expect(c.acq.getTraces().primary).toHaveLength(LIVE_BUFFER_SIZE);
    c.acq.startCapture();
    for (let i = 0; i <= MAX_RECORDING_SAMPLES; i++)
      c.send(25_000 + i / 10, i % 2);
    const result = c.acq.getSnapshot().result!;
    expect(result.status).toBe("interrupted");
    expect(result.score).toBeNull();
    expect(result.sampleCount).toBe(MAX_RECORDING_SAMPLES);
    expect(result.quality.issues).toContain("bufferLimit");
    expect(c.acq.getSnapshot().baseline).toEqual(baseline);
    c.acq.dispose();
  });
  it("provides a stable React snapshot and batches notification-driven changes to10Hz", () => {
    const c = clock();
    c.acq.connect(info);
    c.acq.startBaseline();
    const initial = c.acq.getSnapshot();
    const change = vi.fn();
    const off = c.acq.subscribe(change);
    c.send(0, 1);
    expect(c.acq.getSnapshot()).toBe(initial);
    for (let i = 1; i <= 1_000; i++) {
      c.send(i * 2, i % 2);
      c.tick(i * 2);
    }
    expect(change.mock.calls.length).toBeLessThanOrEqual(20);
    expect(change.mock.calls.length).toBeGreaterThan(0);
    expect(c.acq.getTraces().primary).toHaveLength(1_001);
    expect(c.acq.getSnapshot()).toBe(c.acq.getSnapshot());
    off();
    c.acq.dispose();
  });
  it("erases traces, device and reference on an explicit identity-session clear", () => {
    const c = clock();
    c.calibrate();
    c.acq.startCapture();
    c.send(20_000, 18);
    c.acq.clearSession();
    expect(c.acq.getTraces()).toEqual({
      primary: [],
      temperature: [],
      gsr: [],
    });
    expect(c.acq.getSnapshot()).toMatchObject({
      connected: false,
      phase: "idle",
      device: null,
      baseline: null,
      result: null,
      latestSample: null,
      sampleCount: 0,
    });
    c.send(20_100, 19);
    expect(c.acq.getTraces().primary).toEqual([]);
    c.acq.dispose();
  });
});
