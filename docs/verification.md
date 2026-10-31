# Verification record

Verified locally on 1 November 2026. The final application root is `NeuroFront - Copy`; the frontend and local API run together with `npm run dev` at `http://localhost:5180`.

## Build and automated checks

- TypeScript checking and the production Vite build passed in the final folder.
- All 87 unit/integration tests passed. The final-folder run passed 73 tests initially; the database and workspace suites timed out under machine load. Their 14 tests passed when rerun with one worker.
- `npm run check:i18n` passed for all 13 dictionaries, with 265 interface keys and nine complete articles per language.
- The dependency audit reported zero vulnerabilities during implementation.
- Backend checks include ownership/RLS and invalid baseline relationships in PGlite, save retry IDs, captured-auth identity isolation, account clearing, guest transfer consent, rate limits, bounded assistant context and failure paths. These are local automated checks, not a live Supabase deployment test.
- Local frontend, logo and API status requests returned HTTP 200. The unconfigured status correctly reports cloud and assistant services as unavailable. Assistant requests return a clear 503, foreign-origin requests are rejected, and account deletion without authentication returns 401.
- The first production smoke check caught extensionless server ESM imports that worked under the local TypeScript runner but failed in plain Node. Explicit `.js` import paths resolve that issue. All four transpiled API entrypoints now import in plain Node, with status 200, unavailable assistant routes 503 and unauthenticated account access 401. The 15 targeted auth/security/assistant tests also passed after this correction. `npm run check:server` repeats the compiled-runtime check and is included in the production build.

## Browser checks

The earlier frozen production build passed all 26 simulated device/acquisition browser checks. See [the detailed protocol and acquisition report](core-verification.md) for the exact build, measured timings, sample counts and test list. These measurements preceded the folder relocation and final presentation-only fixes. They used the normal device parser with explicitly labelled simulated notifications, not a physical NeuroFront device.

Final-folder checks used headless Chromium on Windows, with desktop and narrow viewports:

- English guest navigation through Overview, Measure, History, Learn and Assistant at 1440, 390 and 320 pixels. The actual traced SVG logo loaded successfully at each size. Assistant drafts survived navigating away and back.
- Tamil authentication, account creation, password recovery, Overview, Learn, native language selection, recorded history chart labels and Assistant at 320 and 390 pixels passed all 26 targeted assertions. Long chart labels wrap rather than being compressed.
- The 320-pixel Tamil Overview overflow was fixed with shrinkable grid tracks and wrapping values.
- The final English sweep found a seven-pixel overflow in the 320-pixel History date filters. Adding `min-width: 0` to the flex labels corrected the intrinsic date-input sizing. A fresh final check passed English and Tamil Overview and History at 320 pixels: document width and scroll width were both 320; both date controls remained within the viewport. This final targeted run had no console or page errors.
- Screenshots of narrow Tamil Overview, the history filters and the actual logo were inspected. Earlier locale checks also covered all 13 dictionaries and Urdu right-to-left layout.

Local browser evidence is retained in the ignored `.work/qa/` folder. The repeatable device flow is `npm run test:browser` against a frozen `npm run preview` build. Development hot reload should not be triggered during timed acquisition checks.

## Explicit limits

No physical NeuroFront peripheral or phone was available. Browser emulation does not establish real-phone GPU performance, Bluetooth reliability, electrode contact quality or clinical accuracy. The firmware's existing first-field parser and calculation are preserved and regression-tested, but a physical connection/notification smoke test is still needed.

Supabase, email verification/recovery, Google OAuth and the paid model provider remain unconfigured. Their real network flows and cross-device account persistence could not be exercised. Setup steps and required environment variables are in [backend setup](backend.md). Guest connection, measurement, review and export remain independent of these providers.

Language dictionaries were machine-assisted and checked for key coverage, script rendering and layout. Native-speaker review is still recommended. No professional translation, clinical validation, physical-device test or complete accessibility audit is claimed.
