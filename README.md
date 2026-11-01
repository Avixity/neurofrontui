# NeuroFront UI

The original HTML, CSS and JavaScript dashboard, with a compact measurement workspace and 13 interface languages.

Run locally from this folder:

```sh
python -m http.server 5180 --bind 127.0.0.1
```

Open http://localhost:5180. The existing Chart.js CDN and Google Fonts links are retained.

Connect the device, then choose **Recalibrate** or **Use Saved Baseline**. Connecting alone does not start calibration. Recalibration keeps the active baseline intact until completion and can be cancelled. The circular timer shows a 20-second calibration window; the existing 400-sample requirement is retained, with up to five additional seconds for delayed samples before reporting failure. Measurement remains 15 seconds.

The most recent successful baseline is stored in this browser as actual samples and calculated features, together with its date, units, device configuration and calculation version. Saved records are checked for compatibility and feature consistency before reuse. Clearing browser storage removes this saved baseline. A storage failure leaves the newly calibrated baseline usable for the current session and preserves any earlier saved record.

Language selection is stored separately. Translation updates affect displayed text only. The setup illustration opens in an accessible larger dialog. Short windows, phones and enlarged text use natural scrolling.

Run the simulated baseline regression checks without installing dependencies:

```sh
node baseline.test.cjs
```

These checks cover explicit baseline choice, successful and interrupted calibration, persistence, invalid records, storage failures, calculation fixtures and the existing BLE identifiers. They simulate notifications and time; they do not establish physical-device connectivity. Physical hardware and native-speaker translation review remain separate checks.
