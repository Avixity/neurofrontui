import {
  CHARACTERISTIC_UUID,
  SERVICE_UUID,
  type BluetoothAdapter,
  type BluetoothCharacteristic,
  type BluetoothDevice,
  type BluetoothServer,
} from "./device";

export type SimulationMode = "rest" | "active" | "flat" | "invalid" | "silent";

/** Deterministic test peripheral. It never reads navigator.bluetooth or uses a radio. */
export function makeSimulatedBluetooth() {
  let mode: SimulationMode = "rest";
  let timer: ReturnType<typeof setInterval> | null = null;
  let sample = 0,
    notifications = 0,
    requests = 0,
    connections = 0,
    disposed = false;
  const characteristic = new EventTarget() as BluetoothCharacteristic;
  const device = new EventTarget() as BluetoothDevice;
  device.name = "NeuroFront (simulated)";
  device.id = "neurofront-simulated-peripheral-v1";

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }
  function notify() {
    const phase = (sample++ % 20) / 20;
    if (mode === "silent") return;
    const gaussian = (centre: number, width: number) =>
      Math.exp(-0.5 * ((phase - centre) / width) ** 2);
    const pulse =
      4 * gaussian(0.18, 0.045) -
      8 * gaussian(0.36, 0.025) +
      48 * gaussian(0.42, 0.025) -
      12 * gaussian(0.48, 0.03) +
      7 * gaussian(0.7, 0.09);
    const value =
      mode === "flat" ? 12 : 12 + (mode === "active" ? 1.6 : 1) * pulse;
    const payload = mode === "invalid" ? "invalid\n" : `${value.toFixed(4)}\n`;
    const bytes = new TextEncoder().encode(payload);
    characteristic.value = new DataView(bytes.buffer);
    notifications += 1;
    characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
  }
  const server: BluetoothServer = {
    connected: false,
    async connect() {
      if (disposed) throw new Error("Simulation disposed");
      server.connected = true;
      connections += 1;
      return server;
    },
    disconnect() {
      stop();
      const wasConnected = server.connected;
      server.connected = false;
      if (wasConnected)
        device.dispatchEvent(new Event("gattserverdisconnected"));
    },
    async getPrimaryService(uuid) {
      if (uuid !== SERVICE_UUID || !server.connected)
        throw new Error("Simulation service unavailable");
      return {
        async getCharacteristic(characteristicUuid) {
          if (characteristicUuid !== CHARACTERISTIC_UUID)
            throw new Error("Simulation characteristic unavailable");
          return characteristic;
        },
      };
    },
  };
  device.gatt = server;
  characteristic.startNotifications = async () => {
    if (!server.connected || disposed)
      throw new Error("Simulation not connected");
    if (!timer) timer = setInterval(notify, 50);
    return characteristic;
  };
  const adapter: BluetoothAdapter = {
    async requestDevice() {
      if (disposed) throw new Error("Simulation disposed");
      requests += 1;
      return device;
    },
  };
  return {
    ...adapter,
    source: "simulated" as const,
    setMode(value: SimulationMode) {
      mode = value;
    },
    getMode: () => mode,
    getStats: () => ({
      requests,
      connections,
      notifications,
      running: timer !== null,
    }),
    disconnect: () => server.disconnect(),
    dispose() {
      server.disconnect();
      disposed = true;
    },
  };
}

export type SimulatedBluetooth = ReturnType<typeof makeSimulatedBluetooth>;
