# NeuroFront Assistant setup

The dashboard stays a plain HTML, CSS and JavaScript application. The assistant adds one read-only Node endpoint at `/api/assistant`. Bluetooth, recording, calibration, scoring and history do not call that endpoint and remain usable when it fails.

The first measurement paragraph and comparison summary are generated locally from the saved capture and translated templates. They work without API credentials. Personalized replies require Groq and configured server-side rate limiting. Account model access and representative live responses have been checked with synthetic captures; no physical device or personal history was used for those checks.

## Server environment

Set these under the existing `neurofrontui` Vercel project's environment variables. Select the intended Production and Preview environments, then redeploy. Do not put credentials in HTML, JavaScript delivered to browsers, chat prompts, browser storage or Git.

| Variable | Purpose |
| --- | --- |
| `GROQ_API_KEY` | A key from the Groq project used for this application. |
| `GROQ_MODEL` | Defaults to `openai/gpt-oss-20b`. Check the model is enabled for your Groq account. |
| `GROQ_REVIEW_MODEL` | Separate input/output review model. Defaults to `openai/gpt-oss-120b`. |
| `ASSISTANT_RATE_BACKEND` | Optional `vercel`, only after the native Firewall rule described below is active. Otherwise Redis is required in production. |
| `UPSTASH_REDIS_REST_URL` | HTTPS REST URL from an Upstash Redis database. |
| `UPSTASH_REDIS_REST_TOKEN` | Server-side REST credential with permission for `EVAL`, `GET`, `INCR` and `EXPIRE`. |
| `ASSISTANT_RATE_SALT` | Random secret of at least 32 characters used to hash network addresses in rate-limit keys. |

Generate a salt locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and paste it directly into Vercel's server environment setting. Keep it private. `.env.example` contains names and safe defaults only. `.env*` files are ignored except that example.

Groq currently lists `openai/gpt-oss-20b` as a production model supporting strict structured output. Its availability in a particular account must still be checked in the Groq console or with the authenticated `/openai/v1/models` endpoint. Set a model supported by the account rather than assuming a model name is sufficient. The implementation uses strict JSON schemas for the production GPT-OSS models. Other configured Groq models use JSON-object mode plus the same application-side schema and content validation. Validate regional-language quality for any selected model before relying on it.

Choose one production rate-limit backend:

- Upstash: configure both Redis variables. It stores only expiring counters keyed by a salted hash of the Vercel-supplied client IP, plus an aggregate counter. Atomic limits are 12 requests per minute and 120 per day per network address, and 120 per minute across the application. It stores no messages, capture data or raw IP addresses.
- Native Vercel Firewall: activate and verify a rate-limit rule matching POST requests to `/api/assistant`, blocking above 12 requests per minute per IP, then explicitly set `ASSISTANT_RATE_BACKEND=vercel`. Vercel Firewall counters are regional, not a global daily quota. Additional function-local minute, daily and concurrency counters are best-effort limits that reset on cold starts. Use Redis if a globally atomic daily spending limit is required.

Both options require `ASSISTANT_RATE_SALT` and the platform-supplied forwarded IP. Shared networks share an address limit. Production fails closed unless Redis is configured or native Vercel mode is explicitly enabled. The native rule is managed in the Vercel project, not created by this source file. Local development uses an in-memory limiter.

## Local preview

Use Node 22 or later. No package installation or framework migration is required.

Without provider credentials:

```powershell
node local-server.cjs
```

With a local `.env.local` copied from `.env.example` and filled outside Git:

```powershell
node --env-file=.env.local local-server.cjs
```

Open `http://localhost:5180`. To use another port, set `PORT` in the local environment. The server binds to loopback. A generic static file server cannot run the personalized endpoint and may expose files that the supplied local server explicitly excludes.

## Deployment and data boundaries

`vercel.json` explicitly builds the root `assistant-api.js` as a Node function and maps `/api/assistant` to it. A static allowlist includes only the dashboard's public files. Server source, tests, environment files and setup instructions are excluded from public static output. The direct function filename is blocked as a public route. This uses Vercel's documented legacy `builds` option to satisfy this project's root-only file structure.

Guest requests include only the explicitly selected capture summary, baseline features and fingerprint, up to twelve earlier summaries, and a bounded conversation. Full waveforms, identity details and arbitrary notes are not sent to the model. Guest summaries are validated but cannot be authenticated as physical-device readings. When Supabase is configured, signed-in requests send a Bearer token and capture ID instead of client-controlled measurement context. The server verifies the user with Supabase Auth and loads only that owner's records through RLS. See [Account setup](ACCOUNTS_SETUP.md) for the database and authentication configuration.

Guest conversation text is kept in the open tab. Signed-in conversations are saved through the account service with stable thread/message IDs and their actual completion status. Minimizing or clicking outside the panel retains the conversation; New Chat starts a new thread. Requests send the necessary selected context to Groq only after the user's explicit action. Groq's account/data policies still apply to provider processing.

The light chat panel uses a compact header and composer, with the conversation occupying the remaining space. Opening the launcher inserts one translated local greeting into an empty chat. The launcher is hidden while the panel is open. A short introduction extends from the closed launcher for 3.5 seconds after page load. Loading and retry appear as one inline status beneath the latest message; they do not replace the deterministic measurement explanation.

## Avatar asset

`assistant-avatar.webp` is an original fictional male portrait made with the built-in image-generation tool, then resized and encoded as a 384 x 384 WebP (12,544 bytes). It represents an AI assistant, not a clinician or a real member of staff.

Generation prompt: "Use case: photorealistic-natural. Asset type: small circular NeuroFront AI chatbot avatar. Create an original fictional adult man, approximately early thirties, with a friendly approachable natural smile, warm expressive eyes, neatly styled short dark hair, subtle natural stubble and a clean dark navy casual crewneck shirt with a very restrained cyan accent. Realistic professional portrait photography, authentic skin texture, calm soft daylight, polished but human and not airbrushed. Centred front-facing head-and-shoulders composition, face large and clearly readable when reduced to a 56px circular crop, leave room above hair and beside face. Plain soft light-neutral background, no scenery. No text, no logos, no medical coat, no stethoscope, no medical credentials, no glasses, no extra people, no cartoon or robotic features. Square composition."

## Validation and safety

- Same-origin JSON POST requests only, no browser credentials or cross-origin API access.
- Strict request allowlists, 32 KiB body limit, at most eight messages of 1,200 characters, and twelve previous capture summaries.
- Server-owned system instructions. Client `system`, `developer` and `tool` roles and unknown fields are rejected. All accepted dialogue is placed inside an untrusted user-data envelope.
- No tools, code execution, record mutation, Bluetooth access or arbitrary URL fetching.
- Configured shared rate limiting, four concurrent provider requests per function instance and a 25-second provider deadline. Closing the browser request aborts provider work.
- Independent input classification, structured answer generation and a separate semantic review of safety, grounding and requested language. All must pass before generated text is returned.
- Capture numbers and dates use server-generated fact placeholders or exact approved literal values. Unknown facts, unmatched numbers, HTML, Markdown links, images, executable content and arbitrary resource IDs are rejected. Independent review checks the semantic relationship between approved values and claims. Article links are allowlisted IDs opened by the application.
- A provider `json_validate_failed` response receives one bounded JSON-object retry within the same deadline. The same local validation and independent review still apply. No retry is made for provider rate limiting.
- The supplied score category and comparisons are checked using the same `score-config.js` configuration as the dashboard. The selected capture is excluded from its own comparison; mismatched baselines or calculation settings are excluded.
- Provider reasoning, credentials and raw provider errors are never returned. Output is rendered as text, with separate in-app article buttons. The deterministic first paragraph is not sent to be rewritten.

These layers reduce risk; semantic model checks do not constitute a mathematical guarantee against every prompt attack or hallucination. If validation fails, the locally generated explanation remains visible and the personalized part offers Retry. No score constitutes a medical diagnosis.

## Checks

```powershell
node --test assistant-server.test.cjs
node baseline.test.cjs
node capture-history.test.cjs
```

The server suite uses explicitly simulated provider responses and synthetic capture data. It checks strict role/context validation, every supported language code, comparison arithmetic, unsupported output facts, encoded/multilingual/role-play attack isolation, moderation rejection, provider failure, timeout, cancellation, rate limits, origin/body restrictions, concurrent guest isolation and static file exposure. Mocked moderation tests verify the fail-closed orchestration, not a real model's attack-detection accuracy.

Optional real-provider checks use synthetic records and consume provider quota:

```powershell
node --env-file=.env.local assistant-live-check.cjs english
node --env-file=.env.local assistant-live-check.cjs comparison
node --env-file=.env.local assistant-live-check.cjs hindi urdu hinglish
node --env-file=.env.local assistant-live-check.cjs attack-hindi attack-urdu attack-roleplay attack-encoded
```

During implementation, live English, Hindi, Urdu and Hinglish questions, synthetic comparisons, follow-ups, missing/incompatible history, and representative multilingual/encoded/role-play attacks were exercised. Provider rate limiting and strict-output errors were also observed and handled. These are bounded smoke checks, not an exhaustive model-safety or professional translation review. Repeat them when models change; stop a batch on provider rate limits. No physical NeuroFront device verification is implied.

## Official references

- [Groq production and supported models](https://console.groq.com/docs/models)
- [Groq structured outputs and model support](https://console.groq.com/docs/structured-outputs)
- [Groq API reference](https://console.groq.com/docs/api-reference)
- [Groq content moderation guidance](https://console.groq.com/docs/content-moderation)
- [Vercel root build configuration and static allowlists](https://vercel.com/docs/project-configuration/vercel-json#builds)
- [Vercel forwarded IP request headers](https://vercel.com/docs/headers/request-headers)
- [Upstash Redis REST API](https://upstash.com/docs/redis/features/restapi)
