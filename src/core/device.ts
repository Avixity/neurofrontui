import type { DeviceInfo, Source } from "../types";

export const DEVICE_NAME = "NeuroFront";
export const SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab";
export const CHARACTERISTIC_UUID = "abcd1234-5678-1234-5678-abcdef123456";
export const PROTOCOL_VERSION = "neurofront-csv-primary-v1";
export const DEVICE_SETUP = "wired-headband-controller-v1";
export const REQUEST_OPTIONS = {
  filters: [{ name: DEVICE_NAME }, { namePrefix: DEVICE_NAME }],
  optionalServices: [SERVICE_UUID],
};

export type ReceivedSample = {
  value: number;
  receivedAt: number;
  timestamp: number;
};
export type ConnectionStatus =
  "disconnected" | "connecting" | "connected" | "unavailable" | "error";
export type DeviceError = "cancelled" | "unavailable" | "error";
export type ConnectionSnapshot = {
  status: ConnectionStatus;
  device: DeviceInfo | null;
  error: DeviceError | null;
};

export interface BluetoothCharacteristic extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<unknown>;
}
export interface BluetoothService {
  getCharacteristic(uuid: string): Promise<BluetoothCharacteristic>;
}
export interface BluetoothServer {
  connected: boolean;
  connect(): Promise<BluetoothServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BluetoothService>;
}
export interface BluetoothDevice extends EventTarget {
  name?: string;
  id?: string;
  gatt?: BluetoothServer;
}
export interface BluetoothAdapter {
  requestDevice(options: typeof REQUEST_OPTIONS): Promise<BluetoothDevice>;
}
export type DeviceCallbacks = {
  onConnection?: (snapshot: ConnectionSnapshot) => void;
  onSample?: (sample: ReceivedSample) => void;
  onInvalidPacket?: (packet: {
    raw: string;
    receivedAt: number;
    timestamp: number;
  }) => void;
};
export type DeviceDependencies = {
  bluetooth?: BluetoothAdapter | null;
  source?: Source;
  now?: () => number;
  wallNow?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export function parseNotification(value: DataView): {
  raw: string;
  value: number | null;
} {
  const raw = new TextDecoder().decode(value).replace(/\0/g, "").trim();
  const parsed = Number.parseFloat(raw.split(",")[0] ?? "");
  return { raw, value: Number.isFinite(parsed) ? parsed : null };
}

export function createDeviceClient(
  callbacks: DeviceCallbacks = {},
  dependencies: DeviceDependencies = {},
) {
  const bluetooth =
    dependencies.bluetooth === undefined
      ? (
          globalThis.navigator as
            (Navigator & { bluetooth?: BluetoothAdapter }) | undefined
        )?.bluetooth
      : dependencies.bluetooth;
  const now = dependencies.now ?? (() => performance.now());
  const wallNow = dependencies.wallNow ?? Date.now;
  const sleep =
    dependencies.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let device: BluetoothDevice | null = null;
  let characteristic: BluetoothCharacteristic | null = null;
  let generation = 0,
    disposed = false;
  let pending: Promise<void> | null = null;
  let snapshot: ConnectionSnapshot = {
    status: bluetooth ? "disconnected" : "unavailable",
    device: null,
    error: null,
  };

  function publish(
    status: ConnectionStatus,
    info: DeviceInfo | null = null,
    error: DeviceError | null = null,
  ) {
    snapshot = Object.freeze({ status, device: info, error });
    callbacks.onConnection?.(snapshot);
  }
  function cleanUp() {
    const previous = device;
    characteristic?.removeEventListener(
      "characteristicvaluechanged",
      handleNotification,
    );
    previous?.removeEventListener("gattserverdisconnected", handleDisconnect);
    characteristic = null;
    device = null;
    if (previous?.gatt?.connected) previous.gatt.disconnect();
  }
  function handleDisconnect() {
    generation += 1;
    pending = null;
    cleanUp();
    if (!disposed) publish("disconnected");
  }
  function handleNotification(event: Event) {
    if (disposed || event.target !== characteristic || !device?.gatt?.connected)
      return;
    const receivedAt = now(),
      timestamp = wallNow();
    const data = characteristic?.value;
    const parsed = data ? parseNotification(data) : { raw: "", value: null };
    if (parsed.value === null) {
      callbacks.onInvalidPacket?.({ raw: parsed.raw, receivedAt, timestamp });
      return;
    }
    callbacks.onSample?.({ value: parsed.value, receivedAt, timestamp });
  }
  async function open(token: number) {
    if (!bluetooth) {
      publish("unavailable", null, "unavailable");
      return;
    }
    cleanUp();
    publish("connecting");
    let candidate: BluetoothDevice | null = null;
    try {
      candidate = await bluetooth.requestDevice({
        filters: REQUEST_OPTIONS.filters.map((filter) => ({ ...filter })),
        optionalServices: [...REQUEST_OPTIONS.optionalServices],
      });
      if (token !== generation || disposed) return;
      if (!candidate.gatt) throw new Error("GATT unavailable");
      device = candidate;
      candidate.addEventListener("gattserverdisconnected", handleDisconnect);
      const server = candidate.gatt.connected
        ? candidate.gatt
        : await candidate.gatt.connect();
      if (token !== generation || disposed) {
        if (server.connected) server.disconnect();
        return;
      }
      const service = await server.getPrimaryService(SERVICE_UUID);
      if (token !== generation || disposed) return;
      const found = await service.getCharacteristic(CHARACTERISTIC_UUID);
      if (token !== generation || disposed) return;
      characteristic = found;
      found.addEventListener("characteristicvaluechanged", handleNotification);
      let lastError: unknown;
      let started = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (token !== generation || disposed) return;
        try {
          await found.startNotifications();
          started = true;
          break;
        } catch (error) {
          lastError = error;
          await sleep(180);
        }
      }
      if (token !== generation || disposed) return;
      if (!started) throw lastError;
      publish(
        "connected",
        Object.freeze({
          name: candidate.name || DEVICE_NAME,
          ...(candidate.id ? { id: candidate.id } : {}),
          serviceUuid: SERVICE_UUID,
          characteristicUuid: CHARACTERISTIC_UUID,
          protocol: PROTOCOL_VERSION,
          setup: DEVICE_SETUP,
          timestampSource: "browser-receipt",
          source: dependencies.source ?? "bluetooth",
        }),
      );
    } catch (error) {
      if (token !== generation || disposed) return;
      cleanUp();
      const cancelled =
        error instanceof Error &&
        (error.name === "NotFoundError" || error.name === "AbortError");
      publish(
        cancelled ? "disconnected" : "error",
        null,
        cancelled ? "cancelled" : "error",
      );
    }
  }
  function connect(): Promise<void> {
    if (disposed || snapshot.status === "connected") return Promise.resolve();
    if (pending) return pending;
    const token = ++generation;
    const task = open(token);
    pending = task;
    void task.finally(() => {
      if (pending === task) pending = null;
    });
    return task;
  }
  function disconnect() {
    generation += 1;
    pending = null;
    cleanUp();
    if (!disposed) publish("disconnected");
  }
  return {
    connect,
    disconnect,
    async reconnect() {
      disconnect();
      await connect();
    },
    getSnapshot: () => snapshot,
    dispose() {
      if (disposed) return;
      disconnect();
      disposed = true;
    },
  };
}
