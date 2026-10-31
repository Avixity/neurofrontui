# Device and acquisition core

`legacy/README.md` records the original source, hashes, protocol and formula. The archived source is evidence, not a second runtime.

## Integration

```ts
const acquisition = createAcquisition({ onBaseline: saveBaseline, onComplete: reviewMeasurement });
const client = createDeviceClient({
  onConnection: state => {
    if (state.status === 'connected' && state.device) acquisition.connect(state.device);
    else if (state.status !== 'connecting') acquisition.disconnect();
  },
  onSample: acquisition.acceptSample,
  onInvalidPacket: acquisition.invalidPacket,
});
// Only explicit user actions call these:
await client.connect();
acquisition.startBaseline(); // true20s; never starts merely because a device connected
acquisition.startCapture(); // true15s; requires a compatible saved baseline
```

`createAcquisition()` exposes `connect`, `disconnect`, `setBaseline`, `startBaseline`, `startCapture`, `cancel`, `interrupt`, `reset`, `clearSession`, `subscribe`, `getSnapshot`, `getTraces`, `acceptSample`, `invalidPacket`, `tick` and `dispose`. Actions return synchronously; start/setBaseline return a success boolean. `getSnapshot()` is stable between emissions and works with `useSyncExternalStore`. Notification-driven updates emit at most 10 Hz. Chart consumers may read actual sample arrays independently, up to 30 Hz. There is no render-loop sampling. Use `clearSession()` on identity changes to erase prior private traces and device metadata; ordinary `reset()` retains recent samples for the same person's live preview.

`getTraces()` returns the active recording, then a completed/interrupted capture while it is selected by the core phase, otherwise up to1200 recent actual samples. Temperature and GSR arrays remain empty because this protocol only supplies one parsed numeric channel. Their nominal unit metadata does not mean a value was received. Primary values retain device units; no conversion is invented.

## Recording rules

- `receivedAt` uses the browser's monotonic clock. Each stored sample has elapsed milliseconds `t`, receipt epoch milliseconds `timestamp`, and its original finite `value`. Clock/frame delays do not synthesize samples. The sample at the exact window deadline belongs outside that recording.
- A baseline takes20000ms and a capture15000ms. Recording requires at least two finite samples, at least80% temporal coverage, and no gap of5000ms or more, including the first/tail gap. These are acquisition-integrity checks, not clinically established signal-quality thresholds.
- Invalid packets do not refresh the last valid sample. A missing/stale signal interrupts the window. The owner must call `interrupt('hidden')` on document visibility loss. Disconnect/cancel also interrupt. A capture produces an immutable interrupted record with a null score; an interrupted baseline does not replace the prior baseline.
- Flat values produce a `flat` quality warning. The original formula remains unchanged, including a score of12 for constant baseline and capture signals. A quality warning is not a lead-off diagnosis.
- Recorded windows are bounded at20000 actual samples. Exceeding that limit produces `bufferLimit`; samples are not silently truncated into a successful result.
- A capture pins a deep copy of the exact selected baseline. All completed records, sample arrays, nested baseline snapshots and identifiers are immutable. Notes can be edited by creating a separate record copy in the persistence/UI layer.
- Saved baselines must have valid traces/features, the current schema, algorithm and acquisition versions, and match source, device identity, setup, UUIDs and protocol. Simulated and Bluetooth records are incompatible. Cancelling, disconnecting or failing recalibration retains the previous baseline.

Machine-readable issues are `noData`, `signalLost`, `hidden`, `disconnected`, `short`, `flat`, `cancelled`, `incompatible`, `bufferLimit`. Display copy belongs to localization.

## Explicit simulation and checks

`makeSimulatedBluetooth()` is an inert test adapter until the normal device client explicitly connects. Pass it as `bluetooth` and pass its `source` (`simulated`) to the device-client dependencies. It emits deterministic protocol notifications every50ms. Its `setMode()` accepts `rest`, `active`, `flat`, `invalid`, or `silent`; `disconnect()` simulates radio loss. It never accesses a radio. The application must only offer it through an explicit development/test mode and must keep simulation visibly labelled. It does not auto-start baseline or capture.

`tests/core.test.ts` uses simulated peripherals and clocks, including exact golden outputs executed from the archived original calculation. `tests/chart.test.ts` covers domain expansion, stable draw fingerprints and the localized reference legend used by PNG export. These checks do not establish physical Bluetooth reliability, sensor accuracy or clinical validity.
