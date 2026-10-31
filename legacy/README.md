# Legacy implementation audit

Captured from clean `Avixity/neurofrontui` commit `e0250c74fc06f043ddf873944e98ddba903316fc` before the redesign. These files are reference snapshots, not the new application entry point. No actual Bluetooth peripheral was connected during this audit.

The copied working-tree files preserve the original CRLF bytes:

| File | SHA-256 |
| --- | --- |
| `app.js` | `ce2543424e5b111cac7f9cbbe59eeec467f12e82e61b9f41f33ed0bc84be6052` |
| `index.html` | `34d19b44efeaf9322044f1f6c06be7ca7e36351c6cb90114ac301f580cf2540c` |
| `styles.css` | `8d65ebc89d1b897b16dd4ea3a8f538f92766311d2db6643049a72c9e0443892c` |

Git may normalize line endings when these snapshots are committed; the hashes above identify the audited original working-tree bytes.

## Bluetooth protocol

- `app.js:1–3`: device name `NeuroFront`, service `12345678-1234-1234-1234-1234567890ab`, characteristic `abcd1234-5678-1234-5678-abcdef123456`.
- `app.js:900–942`: `requestDevice` uses two alternative filters, `{ name: "NeuroFront" }` and `{ namePrefix: "NeuroFront" }`, with the service UUID in `optionalServices`. It reuses a connected GATT server; otherwise it connects, resolves the primary service, resolves the characteristic, installs its notification listener and starts notifications. There is no automatic reconnection loop.
- `app.js:884–897`: notification setup makes at most two attempts, with a 180 ms delay after each failed attempt.
- `app.js:870–881`: decode each notification independently with `TextDecoder`, remove NUL bytes, trim, split on commas and `Number.parseFloat` the first field. No buffering of partial packets, newline framing, scale conversion or interpretation of later fields is implemented. `parseFloat` accepts a numeric prefix (for example, `12units` becomes `12`); only finite results update the reading.
- `app.js:438–441`: a lead-off parser exists but is unused. Notifications always reset `leadOff` to false. A later comma field must not be represented as a verified lead-state, temperature or GSR channel.
- `app.js:831–868`: disconnection removes listeners, drops GATT references and cancels an active capture. A completed preview is retained. The baseline is not reset on disconnect in this legacy implementation.

## Acquisition behavior and defects identified

- `app.js:4–9,342–352`: baseline target is 400 finite notifications, derived from 20,000 / 50. Its displayed “20 seconds” is based on an assumed notification rate, not elapsed timestamps.
- `app.js:502–545,699–727`: capture lasts 15,000 ms on `performance.now()`, but records the latest notification value every 50 ms from the animation loop. It can repeat values or catch up multiple samples after a delayed frame. The capture end check occurs after this resampling loop.
- `app.js:427–435,870–880`: a reading is considered fresh for 5,000 ms. Invalid notifications also refresh the timestamp, potentially extending a stale numeric value. These are acquisition issues, not parts of the physiological calculation.
- Capture buffers are not hard bounded at insertion. Baseline is capped at 400 only after completing.
- `app.js:549–585`: temperature is derived from primary-signal activity and random noise. GSR is derived from a random baseline, primary activity and random noise. Neither is parsed from the device. No raw voltage/temperature/conductance calibration is established by this source.

## Exact calculation to retain

`app.js:146–191` computes mean, RMS, population standard deviation, peak-to-peak range and the mean absolute difference between successive values. Empty input yields zeros. Composite activity is:

```
activity = 0.5 * stdDev + 0.35 * peakToPeak + 0.15 * derivativeMean
```

`app.js:260–282` calculates:

```
baselineActivity = max(1, activity(baseline))
currentActivity = activity(current)
score = clamp(50 + 38 * (currentActivity - baselineActivity) / baselineActivity, 0, 100)
```

The internal category cutoffs are `<35`, `<60`, `<78`, otherwise the final category. Original labels are Relaxed, Balanced, Elevated and High. These are software categories, not validated clinical conclusions. The floor of 1 means a constant zero-activity recording scores 12 even against a constant baseline; it is not always mathematically 50 when the two recordings match. Preserve this behavior while explaining its limitations honestly.

`app.js:463–495` has a separate captured-signal activity summary:

```
summaryActivity = range / max(12, abs(mean) * 0.25)
                + populationStdDev / max(5, abs(mean) * 0.12)
```

Its labels are Stable below 1.1, Moderate Activity from 1.1, and High Activity from 1.9. This summary is distinct from the baseline-relative score.

## Verification scope

The redesign must use simulated notification fixtures to test protocol compatibility, cancellation, stale/invalid packets and timestamp windows. Passing those tests does not establish real-device connectivity, independent sensor channels, a calibrated sampling rate or stress-detection accuracy. Legacy math should be compared directly against functions extracted from this snapshot.
