# NeuroFront cloud accounts

The dashboard remains available to guests without Supabase. Account authentication is performed by Supabase Auth inside the dashboard popup. Account records use Postgres, and avatar images use a private Supabase Storage bucket. No application password table or service-role key is used.

## Required provider setup

The hosted **NeuroFront** project (`feblbpepamcklqgoemyt`) was created on the free plan in Mumbai on 1 November 2026. The `neurofront_accounts` and subsequent `capture_deletion_with_owned_tombstones` migrations are applied, and its public URL and publishable key are configured in local development and the existing Vercel project. Email confirmation is enabled. The dashboard uses the real Supabase service; it does not simulate registration, sign-in or cloud saving.

The project owner confirmed that the production Site URL and redirect URL are both set to `https://neurofrontui.vercel.app/`.

Branded sign-up confirmation and password-reset templates with browser previews are available. See [Email setup](EMAIL_SETUP.md) for the designs, subjects and custom SMTP activation steps. The templates are not active until installed in Supabase after configuring custom SMTP.

**Remaining provider setup:** configure a production SMTP provider. No SMTP credentials were supplied. Supabase's default development mail service restricts recipients and delivery, so public sign-up and password recovery are not considered verified until real confirmation and recovery emails have been tested. These remaining settings do not prevent guest measurement. Add the local callback URLs below if testing email links on a local preview.

1. Create or select the intended Supabase project. In its SQL editor, execute the entire `accounts-migration.sql` file as the project database owner, then execute `accounts-capture-deletion.sql`. Keep both migrations, in that order, in the project's migration history. The first creates the application schema and private `nf-avatars` bucket; the second adds safe capture deletion and protects deleted IDs from delayed uploads. For an existing project with the first migration already applied, apply only the second. Do not rerun the base migration alone after the deletion migration: it would replace the protected save functions and restore the old direct-delete permissions.
2. In Authentication, enable Email with email/password sign-in. Keep email confirmation enabled if verification is required. Configure a production SMTP provider, sender name and sender address. Supabase's default development email service has delivery and recipient restrictions and is not a substitute for production SMTP. Verify delivery of both confirmation and password-reset messages.
3. Set Authentication URL Configuration **Site URL** to `https://neurofrontui.vercel.app/`. Add that exact URL and `http://localhost:5183/` (or the local port in use) to allowed redirect URLs. If using `127.0.0.1` for local checks, allow `http://127.0.0.1:5183/` too. Add only trusted preview URLs when testing email flows there. Both verification and recovery return to the existing dashboard, whose popup handles the callback. No separate account page is needed.
4. Add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from the same project's API settings to `.env.local` and to the existing Vercel project's production and preview environments. A legacy `SUPABASE_ANON_KEY` is supported only as a fallback. Never put a service-role key in either public-key setting. Keep `GROQ_API_KEY` server-side as before.
5. Restart the local server and redeploy Vercel so the configuration endpoint receives those environment variables. Use `node --env-file=.env.local local-server.cjs` with `PORT=5184` for the configured preview at `http://localhost:5184/`. Add that exact URL to the allowed redirects when testing email callbacks locally. The credential-free regression server uses port 5183.
6. Confirm the public `GET /api/account-config` endpoint returns `{ "configured": true, "url": "https://YOUR_PROJECT.supabase.co", "publishableKey": "YOUR_PUBLIC_KEY" }`. It requires no user token because the publishable/anon key is designed for browser use. Other methods return 405; responses are not cached. Missing or unsafe configuration returns `{ "configured": false }`, never a secret or provider error. This endpoint exposes only the intended public Supabase URL and publishable/anon key.

The browser uses the locally bundled **`@supabase/supabase-js` version `2.118.0`** in `supabase-2.118.0.js`. It is loaded only when cloud configuration is available, with PKCE, supported persistent session management and automatic refresh enabled. Registration, confirmation and recovery callbacks return to the dashboard popup. PKCE email links should be completed in the browser that initiated the flow so its verifier is available; after a confirmation in another browser, return and sign in normally. The current browser integration accepts the project's standard `https://<project-ref>.supabase.co` URL. No framework migration or browser-side custom password handling is involved.

Passwords are submitted directly to Supabase Auth. Do not log passwords, reset links, access tokens or refresh tokens. The browser needs the provider-managed session token storage to restore an account across refreshes; application tables contain no password values.

## Schema and ownership

| Table | Stored data | Identity |
| --- | --- | --- |
| `nf_profiles` | Display name, private avatar path, preferences, active baseline and optimistic revision | Authenticated user ID |
| `nf_baselines` | Immutable complete calibration payload with samples, features, device setup and calculation/schema versions | Owner and stable baseline ID |
| `nf_captures` | Immutable full measurement snapshot, graph samples, readings, score/category, summary and exact baseline snapshot | Owner and stable capture ID |
| `nf_capture_deletions` | Deleted capture IDs and deletion timestamps, preventing delayed uploads from restoring them | Owner and stable capture ID |
| `nf_threads` | Conversation title, selected capture and optimistic revision | Owner and stable thread ID |
| `nf_messages` | Ordered structured messages, preset content/context and pending/completed/failed/stopped status | Owner, thread ID and stable message ID |

Row-level security restricts authenticated users to their own records. Capture deletion is available only through its checked RPC; deletion markers are read-only to clients. Other permitted deletes remain owner-scoped. Anonymous clients cannot read private tables or execute the write RPCs. Direct application INSERT/UPDATE grants are revoked. Functions run with a fixed empty search path, derive the owner from `auth.uid()` and validate data before writing. Neither client-supplied IDs nor guessed record IDs establish authority.

Composite foreign keys bind a capture to that owner's baseline, a thread to that owner's capture, and a message to that owner's thread and optional capture. The active profile baseline must also belong to the same user. Referenced baselines cannot be removed while historical relationships still depend on them. The capture-deletion RPC detaches conversation references before removing a capture. Deleting a thread cascades to its messages.

The RPCs are:

- `nf_save_baseline(p_id, p_payload)`: inserts one immutable calibration version. An identical retry succeeds; conflicting data under the same ID fails.
- `nf_save_capture(p_id, p_baseline_id, p_payload)`: validates the complete snapshot against the immutable baseline and stores it once. An identical retry succeeds. A deleted ID fails with SQLSTATE `P0002` instead of restoring the capture.
- `nf_save_profile(p_expected_revision, p_display_name, p_avatar_path, p_preferences, p_active_baseline_id)`: creates the initial profile at revision zero when absent, then updates with optimistic concurrency. Conflicting stale edits fail with SQLSTATE `40001` rather than silently overwriting another browser. An identical retry after a lost acknowledgement returns the already-saved revision.
- `nf_save_thread(p_id, p_expected_revision, p_title, p_capture_id, p_messages)`: atomically saves the thread and ordered messages, validating every linked capture and snapshot. It removes references to that owner's deleted captures before validation, while retaining message text. It uses the same revision and retry rules. Messages are `{id, ordinal, payload}` and payload status must describe the real request state.
- `nf_delete_capture(p_id)`: atomically records an owner-scoped deletion marker, detaches capture context from conversations, increments affected thread revisions and removes that owner's capture. Returns `{id, deleted, deleted_at, affected_threads: [{id, revision}]}`. Repeating the call is safe and does not repeatedly change already-detached threads.

Save RPCs return the saved database rows. Show cloud success only after a successful RPC response. Pending work stays associated with its original authenticated owner. A baseline/capture conflict is an integrity issue to surface, not permission to create a duplicate record under a new ID.

## Capture deletion and delayed synchronization

Deleting a capture preserves all baseline versions, the active baseline selection and existing conversation text. It removes the conversation's capture link and the affected messages' stored capture snapshots and retry context. A deleted capture is no longer available as assistant context. Clients load `nf_capture_deletions` before reconciling pending uploads, so an older browser cannot silently recreate a deleted capture. The deletion marker remains scoped to its original account.

Capture saves, thread saves and deletion share a per-owner transaction advisory lock. A save that completes before deletion is removed by that deletion; a later save of the same ID is rejected. A deletion can also record a marker before a pending capture reaches the server. Thread revisions still detect genuine conflicting edits. The `nf_private` schema holds the original save validators behind the public wrappers and is inaccessible to browser roles. Applying this migration changes schema and permissions, not existing capture data.

Supabase's [authenticated security-definer function advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) intentionally flags these public RPCs for review. They need owner privileges because direct table writes are denied. Each callable function checks `auth.uid()`, validates ownership and payloads, uses a fixed search path and denies anonymous execution; internal validators are not callable by clients. Review new findings against these guarantees rather than treating every definer function as automatically safe.

The project's existing leaked-password-protection warning is separate from capture deletion. That protection remains disabled; Supabase documents it as a [Pro-plan-and-above Auth option](https://supabase.com/docs/guides/auth/password-security). No plan upgrade or password setting was changed by this migration.

## Avatars

`nf-avatars` is private with a 2 MiB file-size limit and only WebP, PNG and JPEG MIME types. The popup decodes and re-encodes a selected image before upload. Each object path is `<authenticated user ID>/<random ID>.webp` (PNG/JPEG paths are also accepted by policy). Storage RLS restricts read, insert, update and delete to that user's first path segment. Profile avatar paths enforce the same ownership. Use authenticated downloads or short-lived signed URLs; do not make the bucket public. Do not accept SVG or user-supplied HTML.

## Assistant account context

An authenticated assistant request sends a Bearer access token and `{language, messages, context: null, accountCaptureId}`. `accountCaptureId` may be null for general questions. The server checks the token with Supabase Auth's `/auth/v1/user` endpoint, then loads any selected capture with that verified owner and the same token. Postgres RLS independently applies to the request. A missing or other-user capture returns a safe not-found response. Authenticated clients cannot submit an alternate client-controlled measurement context or owner ID.

The server reads at most 120 earlier account captures, computes compatibility and comparisons from stored immutable records, and supplies at most 12 concise summaries to Groq. Raw time-series samples, email addresses, avatar data and account tokens are not sent to the model. A prior-history read failure is explicitly unavailable and is not described as an increase, decrease or empty history. Guest requests retain the existing bounded, validated read-only context. All existing model input/output validation, deadlines, limits and safe rendering remain in effect.

## Guest import and privacy

Guest measurements remain in their existing local storage until the user explicitly selects the import action. Imports retain their original dates and stable IDs. Baselines are saved before dependent captures. Duplicate-safe RPCs permit retrying interrupted imports without duplication. Guest data must never be silently uploaded at sign-in, and an account's private local pending queue must never be imported into a different account.

Signing out or switching accounts clears the visible private capture/chat/baseline state, invalidates outstanding requests and preserves the Bluetooth transport. In-flight measurement ownership is fixed when it starts; the application prevents an account transition from assigning it to someone else. Account-backed records remain private to that owner even if an upload is pending when the session changes.

## Verification

Run `node --test accounts-backend.test.cjs assistant-server.test.cjs` for HTTP/auth/context validation and existing assistant safeguards. The database test can execute against PostgreSQL embedded through PGlite without needing provider credentials:

1. Install `@electric-sql/pglite` in a temporary development-tool directory outside the application.
2. Set `PGLITE_MODULE` to that package's absolute installed directory.
3. Run `node --test accounts-backend.test.cjs`.

The database fixture supplies two test identities plus minimal Supabase Auth/Storage schemas. It executes both actual migrations and checks RLS isolation, grants, immutable snapshots, invalid/foreign baseline references, message ownership, storage policies, duplicate writes and stale profile/thread revisions. Deletion tests cover transaction rollback, preserved baselines and conversation text, detached context, repeated deletion, delayed uploads, deleted IDs on different accounts and blocked direct-write/private-function bypasses. PGlite runs PostgreSQL; this test does not establish live Supabase Auth, SMTP, Storage HTTP or production deployment correctness.

Browser suites use Playwright with a local Chromium installation. Set `PLAYWRIGHT_MODULE` to the installed Playwright module directory and `CHROMIUM_PATH` to its Chromium executable if those tools are not already resolvable. Start the local server on port 5183, then set `NEUROFRONT_URL=http://127.0.0.1:5183`. Run these commands sequentially so simultaneous browser suites do not distort timing or consume unnecessary memory:

```text
node accounts-store.test.cjs
node accounts-chat.test.cjs
node account-ui.test.cjs
node accounts-flow.test.cjs
```

- `accounts-store.test.cjs` uses a mocked Auth SDK and owner-scoped REST store to test deliberate guest imports, exact snapshots, duplicate-safe writes, cached pending data, offline retries, revision conflicts and restoration in a separate browser context.
- `accounts-chat.test.cjs` tests the local greeting, brief launcher callout, inline loading/retry states, outside-click dismissal, long-thread scrolling, structured conversation statuses and account-context clearing with mocked account/provider responses.
- `assistant-layout.test.cjs` checks the compact light chat on desktop, narrow mobile, landscape and a simulated keyboard viewport, along with Urdu layout and reduced motion.
- `account-ui.test.cjs` checks actual popup controls, validation, profile/initials, keyboard access, language changes and desktop/mobile layouts with mocked account actions.
- `accounts-flow.test.cjs` runs the complete actual dashboard against simulated Bluetooth notifications and a mocked Supabase Auth/REST implementation. It collects 400 calibration notifications and 300 capture samples through the existing routines, advances their elapsed-time state to the real 20/15-second boundaries, verifies exact persisted snapshots and recalibration history, exports an older PNG, tests explicit idempotent guest import, preserves the connection on sign-out, cancels a capture on forced account switching and restores the saved baseline in a separate mobile browser context.

These browser fixtures are explicitly simulated. They do not register real people, send verification emails, contact a real model, persist to Supabase, or establish physical-device Bluetooth performance. The SQL test validates actual PostgreSQL policies separately. A separate browser context demonstrates restoration through the simulated backend, not an independent physical device or live cloud account.

After configuring the real project, complete this live check with two disposable accounts and two separate browser profiles:

1. Register, verify email, sign in, refresh, request password recovery, reset the password and sign out.
2. Calibrate and complete a simulated or physical capture. Verify backend confirmation, refresh, then sign in through the second browser and restore that baseline, capture, export and conversation.
3. Explicitly import the same guest data twice and verify record counts remain unchanged on the second import.
4. Recalibrate and verify the prior capture's score, graph, baseline and stored explanation remain unchanged.
5. In the second account, try selecting the first account's IDs through REST and the assistant. Confirm no rows and no private responses are returned.
6. Disable networking during a save. Reconnect and retry, confirming one record with the original ID and owner. Test simultaneous preference edits in two browsers and verify a revision conflict is shown.
7. Switch/sign out during calibration or measurement and confirm the user-facing safety flow, device connection and ownership remain correct.
8. Using a disposable test capture, verify deletion removes it after refresh on another browser, preserves its baseline and conversation text, and prevents an older pending upload from restoring it. Keep genuine cross-device conversation revision conflicts visible.

On 1 November 2026, the hosted database was additionally verified in a rolled-back transaction using two synthetic Auth rows and authenticated-role JWT claims. Actual RPC writes, duplicate retries, immutable snapshots, stale revisions, cross-owner reads/deletes/references, anonymous access and forbidden direct writes behaved as intended. A separate query confirmed that no synthetic users or records remained. After the capture-deletion migration, hosted metadata checks confirmed deletion-marker RLS, owner-only reads, authenticated-only delete RPC access, revoked direct capture deletion and inaccessible private validators. No actual user capture was deleted during these checks. Hosted advisors reported the intentional authenticated security-definer RPC findings, informational index findings and the existing disabled leaked-password-protection warning described above. This validates the checked hosted Postgres policies and permissions, not email delivery or an end-to-end browser sign-in.

Live email delivery, real cross-device Supabase authentication and physical NeuroFront hardware still require verification with the configured mail service and hardware. They must not be represented as tested merely because the database and mocked-auth tests pass.

Official setup references: [Supabase Auth user verification](https://supabase.com/docs/reference/javascript/auth-getuser), [Row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
