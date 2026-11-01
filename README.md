# NeuroFront UI

The original HTML, CSS and JavaScript dashboard, with a state-based measurement flow and 13 interface languages.

Run locally from this folder:

```sh
python -m http.server 5180 --bind 127.0.0.1
```

Open http://localhost:5180. The existing Chart.js CDN and Google Fonts links are retained.

Connect the device, then choose **Recalibrate** or **Use Saved Baseline**. Connecting alone does not start calibration. Recalibration keeps the active baseline intact until completion and can be cancelled. The circular timer shows a 20-second calibration window; the existing 400-sample requirement is retained, with up to five additional seconds for delayed samples before reporting failure. Measurement remains 15 seconds.

The most recent successful baseline is stored in this browser as actual samples and calculated features, together with its date, units, device configuration and calculation version. Saved records are checked for compatibility and feature consistency before reuse. Clearing browser storage removes this saved baseline. A storage failure leaves the newly calibrated baseline usable for the current session and preserves any earlier saved record.

After calibration succeeds or a saved baseline is selected, **Start Measurement** opens the electrode placement and preparation dialog. Only **Begin Measurement** starts recording and the countdown. Cancel, Close and Escape leave the selected baseline intact. During recording, the same action area shows a disabled **Measuring…** button. A completed capture presents **Measure Again** and **Export PNG**. Measure Again returns to the baseline choices while keeping the completed result visible until the next recording begins.

Language selection is stored separately. Translation updates affect displayed text only. The graph and readings use a spacious two-column desktop layout, with controls on the lower left and the circular timer on the lower right. Phones, short windows and enlarged text use natural scrolling. The preparation dialog stacks its illustration and instructions on narrow screens.

Run the simulated baseline regression checks without installing dependencies:

```sh
node baseline.test.cjs
```

These checks cover the action states, explicit baseline choice, successful and interrupted calibration, persistence, invalid records, storage failures, duplicate starts, completed-result retention, calculation fixtures and the existing BLE identifiers. They simulate notifications and time; they do not establish physical-device connectivity. Physical hardware and native-speaker translation review remain separate checks.
