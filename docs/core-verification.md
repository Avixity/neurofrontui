# Device and acquisition verification

## Reproducible checks

```sh
npm test -- tests/core.test.ts tests/chart.test.ts
npm run build
npm run preview
# In another terminal, with Playwright Chromium installed:
node scripts/test-browser.mjs
```

`QA_URL` overrides the preview URL, which defaults to `http://localhost:4180`. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` optionally selects an existing Chromium installation. Use a frozen production preview for timed recordings: Vite development hot reload deliberately disposes device listeners and interrupts an active recording when its owner module changes.

The browser script writes its report, screenshots, PNG/CSV exports and a clearly simulated guest fixture into `.work/qa/`. It uses the explicit `?simulate=1` mode, the normal device client/parser, and real browser timers. It never connects a physical peripheral.

## Unit and protocol checks

`tests/core.test.ts` and `tests/chart.test.ts` passed **46 tests**. Coverage includes:

- Seven golden calculation fixtures executed directly from archived original functions: matching signals, changed activity, constant signals, single-sample behavior and offset invariance.
- Exact device filters, service/characteristic UUIDs, first-field `parseFloat` handling, notification retry count/delay, existing-GATT reuse, invalid packets, chooser cancellation, late connection cancellation, listener cleanup and absence of automatic reconnection.
- Explicit baseline/capture initiation; actual elapsed 20-second and 15-second windows; no frame-loop duplication; deadline exclusion; monotonically received sample timestamps; independent missing channels left empty.
- Stale/invalid signal interruption, temporal coverage, flat-signal warning with unchanged score 12, bounded buffers, compatible baseline versions/device/source/setup, frozen baseline/result copies, cancellation/disconnection preservation and identity-session erasure.
- Stable React snapshots with batched updates; deterministic simulated protocol input through the real client; clearing a previous displayed capture when recalibration begins.
- Chart domain expansion for outliers, idle/hidden-channel fingerprints, actual unit metadata, the PNG reference legend and grapheme-safe wrapping of long localized labels.

The coverage/gap checks are application acquisition-integrity rules. They are not clinically validated quality thresholds. The legacy score formula has not been altered.

## Browser evidence

The stable local preview build with entry `assets/index-xaY3A8mi.js` passed **26 of 26 browser checks**, with no console/page errors, HTTP errors or missing images. Environment: headless Chromium **151.0.7922.34**, Windows x64. Desktop viewport was 1440 × 1000; narrow viewport checks used 390 × 844 and 320 × 740. This is browser emulation, not testing on a physical phone.

The measured baseline flow took 20.394 seconds from the automation action through the completed UI state; the record duration was exactly 20,000 ms with 400 received samples. Capture took 15.428 seconds through the completed UI state; its record duration was exactly 15,000 ms with 300 received samples. The resulting score, 72.76308542049037, matched the preserved formula for those exact samples and the pinned baseline. These values describe simulated input only.

The 26 checks were:

1. Authentication view does not automatically connect.
2. Explicit simulation label is visible.
3. Initial connection state has not calibrated.
4. One explicit connection starts notifications.
5. Connection alone never starts a baseline.
6. Baseline follows the real 20-second window.
7. Baseline contains only received primary samples and no fabricated secondary channels.
8. Hiding every channel stops canvas redraw while recording continues.
9. Capture follows the real 15-second window despite graph switches.
10. Capture pins the exact baseline and keeps missing channels empty.
11. Result matches the original baseline-relative formula.
12. Display switches never reconnect the device.
13. Completed graph draw count remains unchanged while notifications continue.
14. Desktop result has no horizontal overflow.
15. PNG export downloads the recorded chart.
16. CSV row counts exactly match measurement and baseline samples.
17. CSV retains source, receipt timestamp, elapsed time, unit and actual value for every received measurement sample.
18. The 390-pixel result has no horizontal overflow.
19. Cancelled recalibration retains the prior baseline.
20. Selecting a saved baseline does not itself start capture.
21. Disconnect creates a reviewable interrupted record with no score.
22. The 320-pixel view has no horizontal overflow.
23. Guest refresh restores history and the selected baseline without reconnecting.
24. Reduced-motion mobile history remains usable without overflow.
25. Images finish loading successfully.
26. No browser or HTTP errors occur.

The PNG was inspected visually: it includes the baseline legend, actual unit label, prototype estimate limitation and explicit simulated-data notice. Mobile charts were scrolled into view before capture so their ResizeObserver dimensions were current. Full-page screenshots of scrolled pages can include fixed navigation at the current viewport position; viewport screenshots are preferable for reviewing that navigation.

The subsequent localized chart-header wrapping change is covered by unit tests and requires only the targeted narrow-language visual check documented with the localization review. Physical Bluetooth reliability, clinical accuracy, real electrode contact quality and physical mobile-GPU performance remain unverified.
