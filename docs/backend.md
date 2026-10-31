# Accounts, saved data and the assistant

The dashboard works locally and on Vercel without cloud credentials. Bluetooth acquisition, the demo, baseline comparison and local history do not depend on Supabase or an AI provider. Account controls and the assistant report unavailable until their real services are configured. The existing NeuroFront UI deployment is retained; no Supabase or model-provider account was created during this implementation.

Malformed browser project configuration is isolated at client initialization and leaves guest mode usable. Browser auth/database requests have a 20-second abort deadline; server verification and database calls have a 10-second deadline. A failed or unreachable provider does not hold the measurement interface behind account setup.

## Local setup

1. Create a Supabase project. In its SQL editor, run `supabase/migrations/202611010001_neurofront.sql` once against a new project. The file creates tables, ownership policies, restricted transactional functions and assistant quotas. It is also suitable for the Supabase migration workflow. Do not run it over unrelated existing tables with the same names.
2. Copy `.env.example` to `.env.local`. Set `VITE_SUPABASE_URL` to the project URL and `VITE_SUPABASE_ANON_KEY` to its publishable key (or legacy anon key). These two values are public. Keep the secret/service-role key exclusively in `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`), with no `VITE_` prefix.
3. Configure Supabase Auth's Site URL as `http://localhost:5180`. Allow redirects to `http://localhost:5180` and `http://localhost:5180/?auth=recovery`. Enable email confirmation and configure a working SMTP service before real users rely on recovery or verification email. The app supports password sign-in, email confirmation, password recovery and password updates. Authentication sessions use the Supabase PKCE flow.
4. Google sign-in is optional. Configure the Google provider and its callback in Supabase first; only then set `VITE_GOOGLE_AUTH_ENABLED=true`. The UI should not advertise an unconfigured provider.
5. To enable the assistant, obtain an AI Gateway API key and put it in `AI_GATEWAY_API_KEY`. Choose a current text model ID from the [live Gateway catalog](https://ai-gateway.vercel.sh/v1/models) and put it in `ASSISTANT_MODEL`. There is deliberately no guessed default model. Generate a random signing secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and put it in `ASSISTANT_SIGNING_SECRET`.
6. Run `npm run dev`, then open `http://localhost:5180`. Vite proxies `/api` to the local Node server at `127.0.0.1:5181`. The API loads `.env.local` and then `.env` without printing their values. Restart both services after changing environment values. Keep `APP_ORIGIN` equal to the browser origin. Using a different host or port requires adjusting it; cross-origin mutations are rejected.

No email delivery, OAuth provider, real account creation, live database, or paid model response can be verified without those services. A configured local project needs an end-to-end sign-up, confirmation, recovery, account switch, save/reload, export and deletion check before release. AI Gateway billing/budget limits should be configured in its own account before public use.

## Enable providers on the existing Vercel project

1. Use the existing `neurofrontui` project connected to `Avixity/neurofrontui`. The repository root contains `package.json` and `vercel.json`; leave Vercel's Root Directory empty. The framework is Vite, the build command is `npm run build`, and the output directory is `dist`.
2. Run the migration in the intended Supabase project. Configure its Auth Site URL as `https://neurofrontui.vercel.app` and allow `https://neurofrontui.vercel.app`, `https://neurofrontui.vercel.app/?auth=recovery` and the local development callbacks above. Add preview callback origins individually only when testing them deliberately.
3. In Vercel's production Environment Variables, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the public project values. Set `SUPABASE_SECRET_KEY` (or the legacy `SUPABASE_SERVICE_ROLE_KEY`), `AI_GATEWAY_API_KEY`, `ASSISTANT_MODEL` and `ASSISTANT_SIGNING_SECRET` as server-only values. Set `APP_ORIGIN=https://neurofrontui.vercel.app`. Do not prefix any privileged key with `VITE_`.
4. Leave `VITE_GOOGLE_AUTH_ENABLED=false` unless Google is configured in Supabase and its Google Cloud OAuth client has the Supabase callback URL. Email/password works independently of Google.
5. Redeploy after adding variables. `VITE_` values are embedded during the build; adding them without rebuilding cannot enable the existing browser bundle.
6. Check `/api/status`, then verify real email confirmation/recovery, two-account isolation, saved baseline/session reload, explicit guest-session transfer, deletion and a streamed assistant response. Before provider setup, the expected status reports `cloudConfigured: false`, `databaseReady: false` and `assistantAvailable: false`; guest measurement remains usable.

Keep preview and production credentials scoped separately. Do not paste secrets into issues, chat messages, source files or screenshots.

## Data model and ownership

| Table | Stored content | Access |
| --- | --- | --- |
| `profiles` | Display name, preferences, selected baseline ID | Its authenticated owner |
| `baselines` | UUID, per-account version, complete trace/features/quality/device snapshot | Read/delete by owner; insert only through `save_baseline` |
| `measurements` | Complete capture, original baseline snapshot, notes and tags | Read/delete by owner; insert only through `save_capture`; only notes/tags may change |
| `bookmarks` | Learn resource ID | Its authenticated owner |
| `conversations` | Optional saved chat transcript | Its authenticated owner; UI opt-in controls saving |
| `assistant_usage` and `assistant_requests` | Keyed hashes, quota windows and replay IDs | Server service client only |

Every exposed table has row-level security. Anonymous access is revoked. A measurement's composite baseline/owner foreign key prevents attachment to another user's baseline. `save_capture` checks `auth.uid()`, validates bounded numeric traces, creates or reuses the exact immutable baseline, and inserts the measurement in one PostgreSQL transaction. Retrying an identical UUID/payload is idempotent. Reusing an ID with different data fails. Existing references prevent deleting a baseline still used by a measurement. Full account deletion cascades through those references.

Snapshots preserve their simulated/Bluetooth source, algorithm/acquisition/schema versions, timing, units, quality and original baseline. They are client-captured prototype data, not independently authenticated device telemetry. Empty interrupted captures remain local rather than creating a cloud record without samples. Each snapshot is at most 1 MiB and each channel has at most 20,000 samples. Database policies protect ownership; they do not certify that a person's supplied physiological readings are true.

Browser database operations capture a token and create an isolated client for that operation. A later account switch cannot redirect an in-flight save into the next account. UI generation guards additionally discard late responses. Servers verify bearer tokens through Supabase `auth.getUser(token)` before account deletion or reading a saved measurement for the assistant. Request bodies never supply a trusted user ID.

Sign-out clears the visible private workspace and disconnects acquisition immediately. Data deletion blocks new account requests, waits for already-started browser database writes, and then calls the verified deletion endpoint. This prevents an in-flight save from recreating data just deleted in the same tab. Other signed-in devices can still write after data-only deletion; account deletion removes the user and prevents new owner-linked records. Refreshing account history preserves unsaved captures in memory. Guest recordings remain in the current tab's session storage while the user decides whether to transfer or discard them; there is no automatic guest-to-account upload.

`loadAccount` initially loads the newest 200 rows per collection and reports `truncated`, `hasMoreMeasurements` and `hasMoreBaselines`. The active baseline is fetched separately if it is older than that page. `loadMoreMeasurements(offset)` and `loadMoreBaselines(offset)` load another 200 records. `exportAccount()` walks all tables in pages and includes stored snapshots, notes, tags, bookmarks and conversations. It fails explicitly if a table exceeds 10,000 records or the combined export exceeds 100 MiB; it does not silently produce a partial export. Request an administrator database export for larger accounts. Export is a paginated read, not a transactionally frozen database backup, so avoid editing records while exporting.

`DELETE /api/account` accepts `{ "scope": "data" | "account", "confirmation": "DELETE" }`. It verifies the initiating account's token and exact request origin. Data deletion uses `delete_my_data`; account deletion uses the server-only Supabase admin API for the verified user. It does not accept a target user ID. The UI is responsible for clearing its account-scoped local copy after success. Short-lived quota records are retained independently to prevent deletion/recreation from bypassing usage limits.

## Assistant request boundaries

`GET /api/status` reports configuration and checks the database migration. The assistant stays unavailable if the gateway, model, signing secret, database or server credential is missing. Provider errors produce explicit error events, never a canned answer presented as AI output.

Signed-in requests use a bearer token verified by Supabase. When a `measurementId` is supplied, the API reads it through that user's JWT and row-level security; it never uses the administrative client to fetch measurement context. A nonexistent or inaccessible ID returns `measurement_not_found` without exposing another account.

Guests may explicitly send only a bounded scalar summary of a selected local capture. It includes features, score, source, quality and sample counts, not raw traces, device identifiers, notes or stored account history. The server labels this context as unverified. A guest cannot request a saved measurement ID. The browser first sends the validated payload to `/api/assistant-session`, receiving a five-minute HMAC ticket bound to its exact payload digest, an HttpOnly/SameSite=Strict guest cookie and a keyed IP hash. `/api/assistant` verifies all three before consuming a one-use request ID in the database.

The raw IP address is not stored. Vercel's overwritten `x-vercel-forwarded-for` is trusted only when `VERCEL=1`; local development uses the actual socket address. Client-supplied forwarding headers are ignored locally. Guest cookie resets do not reset the quota because the quota subject is the keyed IP hash. Users on one shared network share a guest allowance. This limits ordinary abuse; it is not an assertion that IP limits prevent all automated abuse.

Quota consumption is serialized with a PostgreSQL transaction advisory lock. Guests receive 4 requests/minute and 12/day; accounts receive 10/minute and 100/day. Request IDs cannot be replayed. Server-only quota records are pruned after two days when quota processing runs; no cleanup scheduler is configured. A database outage fails closed for the assistant while measurement remains independent.

Requests permit 12 messages, 2,000 characters/message and 12,000 total characters, within a 32 KiB HTTP body. Only user/assistant roles are accepted. Model output is capped at 800 tokens; total generation is bounded to 40 seconds, with first-chunk and between-chunk timeouts. Cancellation propagates from the browser through the server to the AI SDK. The server offers no model tools, file access, external actions or arbitrary provider/model selection. The fixed instructions prohibit clinical/EEG claims and distinguish simulated, interrupted and missing auxiliary data. The model receives only the submitted conversation and bounded selected context; selecting a capture does not give it access to all history.

The fixed project knowledge includes the checked-in English Learn guides, their stable article IDs/titles, navigation, baseline choices, graph-only display controls and explicit guest transfer behavior. Signed-in client summaries are discarded: without a selected saved measurement ID, that account request has no measurement context. Route tests use a mock model stream to verify these boundaries and explicit stream errors; they do not contact an AI provider.

## Verification performed locally

`npx vitest run server` runs request-boundary tests and the real SQL migration in PGlite's PostgreSQL engine. Tests cover immutable/idempotent captures, transaction rollback, cross-account row-level security, baseline ownership, bookmark ownership, restricted updates, data/account deletion, quota limits and replay rejection. Authentication unit tests verify the Auth request and that a database operation retains its initiating token after a session switch. PGlite's `auth.users`/`auth.uid()` are test stubs; these checks do not constitute a live Supabase Auth or provider integration test.

`npx vitest run tests/workspace.test.tsx` exercises the actual React hook with mocked Auth/cloud/acquisition services. It checks explicit guest transfer, immediate sign-out clearing, stale account responses, retained failed captures/baselines, pagination, and late saves after identity changes or deletion. These are lifecycle regression tests, separate from the browser simulator and real service integration checks.

## Implementation references

The migration follows Supabase's [row-level security guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) and [restricted security-definer function guidance](https://supabase.com/docs/guides/database/functions). Server identity uses the documented [getUser verification](https://supabase.com/docs/reference/javascript/auth-getuser); full deletion uses the [server-only admin deletion API](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser). Streaming was implemented against the installed AI SDK 7 package's documentation and source, including `instructions`, bounded `streamText` and explicit full-stream error events; see [AI SDK text generation](https://ai-sdk.dev/docs/ai-sdk-core/generating-text). Proxy handling follows [Vercel request headers](https://vercel.com/docs/headers/request-headers).
