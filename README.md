# NeuroFront UI

The original HTML, CSS and JavaScript dashboard, with a state-based measurement flow and 13 interface languages.

Run locally from this folder:

```sh
node local-server.cjs
```

Open http://localhost:5180. The existing Chart.js CDN and Google Fonts links are retained.

The floating NeuroFront Assistant explains completed captures using offline, translated score templates and matching saved history. Personalized conversation uses a read-only server endpoint. See [Assistant setup](ASSISTANT_SETUP.md) for Groq, production rate limiting, deployment and validation instructions. The dashboard remains usable without those services. Educational Resources start collapsed and remember their expanded state.

The profile button opens authentication and account preferences over the same dashboard. Supabase accounts store versioned baselines, full captures, profile preferences and conversations, with owner-scoped access and a local retry queue. The hosted NeuroFront database is connected; see [Account setup](ACCOUNTS_SETUP.md) for the applied migration, remaining email/callback setup and verification steps. Deployments without Supabase configuration show accounts as unavailable while preserving guest access. No guest data is imported without an explicit choice.

Connect the device, then choose **Recalibrate** or **Use Saved Baseline**. Connecting alone does not start calibration. Recalibration keeps the active baseline intact until completion and can be cancelled. The circular timer shows a 20-second calibration window; the existing 400-sample requirement is retained, with up to five additional seconds for delayed samples before reporting failure. Measurement remains 15 seconds.

For guests, the most recent successful baseline is stored in this browser as actual samples and calculated features, together with its date, units, device configuration and calculation version. Saved records are checked for compatibility and feature consistency before reuse. Clearing browser storage removes this guest baseline. A storage failure leaves the newly calibrated baseline usable for the current session and preserves any earlier saved record. Signed-in accounts save a new immutable baseline version for every successful calibration and retain the selected version in their profile.

After calibration succeeds or a saved baseline is selected, **Start Measurement** opens the electrode placement and preparation dialog. Only **Begin Measurement** starts recording and the countdown. Cancel, Close and Escape leave the selected baseline intact. During recording, the same action area shows a disabled **Measuring…** button. A completed capture presents **Measure Again** and **Export PNG**. Measure Again returns to the baseline choices while keeping the completed result visible until the next recording begins.

Language selection is stored separately. Translation updates affect displayed text only. The graph and readings use a spacious two-column desktop layout, with controls on the lower left and the circular timer on the lower right. Phones, short windows and enlarged text use natural scrolling. The preparation dialog stacks its illustration and instructions on narrow screens.

Capture Results and Capture History sit below the controls. Each successful guest capture is saved once in IndexedDB (`neurofront-captures`, schema 1), using a stable capture ID. Account captures use the same complete record format and checked, duplicate-safe cloud writes. Records include the captured samples, graph bounds, final stress score/category, summary, duration, calculation version, and a copy of the exact baseline samples and features used. Opening a saved capture never recalculates it against the current baseline or changes the live graph. Its Export PNG action uses that saved record. The list loads six records at a time, newest first.

Guest history stays in this browser across refreshes and restarts. It is not a cloud backup; clearing site data removes it. Failed guest writes keep the capture in memory with a Retry action and allow viewing/exporting it. A failed guest save will not survive closing the tab, so retry or export before leaving. Account writes use a separate owner-bound IndexedDB outbox and retry after reconnection. Cloud success appears only after confirmation. Account changes clear private visible state and cancel an unfinished capture while preserving the Bluetooth transport. Storage failures do not prevent device use. Incomplete and empty captures are not added to history.

Six educational guides open in accessible dialogs beneath the history row. All interface labels and article content use the existing 13-language dictionaries. General explanations link to their scientific or health sources. The readings/sensors guides distinguish the current dashboard's derived temperature/GSR indicators from independent sensor measurements; the existing signal processing is unchanged.

Run the simulated baseline regression checks without installing dependencies:

```sh
node baseline.test.cjs
```

These checks cover the action states, explicit baseline choice, successful and interrupted calibration, persistence, invalid records, storage failures, duplicate starts, completed-result retention, calculation fixtures and the existing BLE identifiers. They simulate notifications and time; they do not establish physical-device connectivity. Physical hardware and native-speaker translation review remain separate checks.

`capture-history.test.cjs` runs browser integration checks against the local server with simulated Bluetooth and elapsed time. It requires Playwright and a Chromium installation available outside this application. Set `PLAYWRIGHT_MODULE` to the installed Playwright module path and, if needed, `CHROMIUM_PATH` to its browser executable, then run `node capture-history.test.cjs`. `NEUROFRONT_URL` defaults to `http://127.0.0.1:5180`. The test uses an isolated browser context and checks multiple captures, refresh persistence, old-record exports, live-session isolation, pagination, storage failure/retry, translations, and narrow layouts.
