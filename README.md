# NeuroFront dashboard

The companion dashboard for the NeuroFront student-built wearable prototype. This repository contains the React and TypeScript application, the existing Bluetooth protocol integration, local signal acquisition, optional Supabase accounts/storage, and a server-side AI assistant integration.

The dashboard supports local development and deployment to the existing NeuroFront UI Vercel project. Supabase and AI provider configuration are optional for guest measurement and remain to be supplied. Real hardware was not available for testing. Simulated input is explicitly labelled and is never represented as a physical recording.

## Run locally

Use Node.js 22.12 or newer, then:

```sh
npm ci
npm run dev
```

Open **http://localhost:5180**. The development runner starts Vite on port 5180 and the Node API on `127.0.0.1:5181`. No environment file is needed for the guest measurement interface, local history, educational guides or simulated testing.

Optional accounts and the assistant require real service configuration. Copy `.env.example` to `.env.local` and follow [the backend setup guide](docs/backend.md). It explains Supabase migration setup, email verification/recovery, optional Google sign-in, AI Gateway model selection, environment values and the ownership/security boundaries. Missing configuration leaves those features unavailable without blocking measurement. Never put secret/service-role keys or AI keys in a `VITE_` variable.

## Application structure

- **Overview:** current device state, baseline selection, recent measurements and shortcuts.
- **Measure:** explicit connection, a 20-second resting baseline, a 15-second capture, sample-quality feedback and the captured baseline comparison.
- **History:** saved or local recordings, date filtering, notes, tags, original baseline snapshots and PNG/CSV exports. Account data also has a JSON export.
- **Learn:** nine project-specific guides, supporting sources and optional account bookmarks.
- **Assistant:** streamed explanations with an optional, explicitly attached measurement. It uses a real configured provider; it does not substitute scripted replies when unavailable.
- **Profile and settings:** display name, language/time zone, graph preferences, baseline management, optional chat storage and account/data deletion.

The interface and guides include English, Hindi, Punjabi, Bengali, Marathi, Gujarati, Tamil, Telugu, Kannada, Malayalam, Odia, Assamese and Urdu. Non-English language packs load on demand, and Urdu uses right-to-left layout. See [translation coverage and review limits](docs/translations.md).

## Measurement behavior

The device client preserves the audited service UUID `12345678-1234-1234-1234-1234567890ab` and characteristic UUID `abcd1234-5678-1234-5678-abcdef123456`. The picker targets the NeuroFront device name/prefix. Each valid notification contributes one sample, timestamped on browser receipt; the chart does not manufacture repeated samples from a timer.

The current firmware parser reads the first numeric field of its text/CSV notification. Temperature and GSR remain empty until independently supported readings are provided. They are not derived from the electrical channel. Unsupported Web Bluetooth environments receive an unavailable state; they do not show a fictional connection.

Calibration and capture use elapsed time. Missing data, invalid packets, interruptions, visibility changes and disconnects are recorded or reported rather than silently producing a complete reading. Graph controls change presentation only. A capture retains its original baseline trace, features, quality, device/source details and calculation version so later calibration does not change an old result.

The retained score is a prototype heuristic, not a validated stress percentage, medical diagnosis or trained-model prediction. Activity is `0.50 × standard deviation + 0.35 × peak-to-peak + 0.15 × mean absolute successive difference`. Baseline activity is floored at 1; the comparison is clamped to 0–100. This floor means two flat traces can produce a score of 12 rather than 50. The AD8232 is an electrical-signal/ECG front end, not an EEG sensor.

## Guest and account data

Guest recordings live in the current tab's session storage. They are not uploaded automatically when signing in. The user chooses whether to transfer them; pending guest records remain available in that tab until transferred or discarded. Language/graph preferences use local storage. Browser storage capacity is limited, and the UI reports failed saves rather than claiming persistence.

Account data uses row-level security, immutable UUID-keyed capture/baseline snapshots and an atomic save function. Each request retains the token of its initiating account. Account switches and sign-out clear private UI state and device buffers; late requests cannot populate another account's workspace. Local unsaved recordings remain available in memory if an account refresh or cloud save fails.

History and baselines load in pages of 200, with the active baseline fetched separately when necessary. The full JSON export is paginated and fails explicitly above its documented browser limits. The assistant receives only the conversation and explicitly attached bounded context, not the entire measurement history. Detailed storage, quota, deletion and retention behavior is in [docs/backend.md](docs/backend.md).

## Explicit simulator

Open **http://localhost:5180/?simulate=1** to use the labelled development simulator. It still requires a deliberate Connect, Calibrate and Measure action. It exercises the same notification parser, acquisition controller and snapshots, with `device.source: 'simulated'` preserved.

Only in that query mode, browser QA can use `window.__neurofrontSimulation` to select `rest`, `active`, `flat`, `invalid` or `silent` input, disconnect the adapter or inspect notification statistics. The normal application does not expose or start the simulator. This validates software paths; it does not validate electrodes, hardware accuracy, physiological interpretation or physical Bluetooth compatibility.

## Checks and production bundle

```sh
npm run check:i18n
npm test
npm run build
```

Tests cover acquisition timing and interruptions, packet parsing, score parity, preserved baseline data, chart geometry/decimation, language completeness/lazy loading, signed assistant request boundaries, token binding, deletion barriers, and PostgreSQL ownership/transaction/quota behavior. Database tests execute the actual migration in PGlite with test `auth.users`/`auth.uid()` stubs. They are not live Supabase Auth, SMTP, OAuth or AI-provider tests. Browser simulator checks are separate from hardware testing.

`npm run preview` serves the built frontend at **http://localhost:4180**. To exercise API routes there, also run `node --import tsx server/dev.ts` with `APP_ORIGIN=http://localhost:4180`; the preview proxies `/api` to port 5181. Restart the API after changing server source or environment values because the development API process does not hot-reload.

The existing [GitHub repository](https://github.com/Avixity/neurofrontui) and [Vercel application](https://neurofrontui.vercel.app/) are retained. `vercel.json` builds Vite's `dist` output and preserves `/api` routes. A deployment without provider credentials offers guest measurement, tab-session history, exports and educational guides; account and assistant controls explain that their services are unavailable. Follow the backend guide to enable and verify those services. Running the local commands above does not publish anything.

## Main files

| Location | Responsibility |
| --- | --- |
| `src/App.tsx`, `src/components/`, `src/app.css` | Application navigation, views, charts and responsive UI |
| `src/useWorkspace.ts` | Acquisition lifecycle, identity transitions, save state and explicit guest transfer |
| `src/core/` | Bluetooth client, timestamp-based acquisition, original score formula and explicit simulator |
| `src/services/` | Auth, token-bound cloud access, guest storage, exports and assistant streaming |
| `src/i18n/`, `src/content/` | Typed language dictionaries and sourced educational guides |
| `server/`, `api/` | Verified server routes, bounded assistant requests, streaming and local API runner |
| `supabase/migrations/` | Tables, row-level policies and transactional functions |
| `tests/`, `server/*.test.ts` | Software and database checks |
| `legacy/`, original `app.js` | Preserved original implementation for protocol/formula auditing |
