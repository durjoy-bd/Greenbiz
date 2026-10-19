# GreenBiz managed AI service

A Vinext service on Sites for the GreenBiz Android app. One hosted OpenRouter credential funds app requests; users do not configure a server or an API key. The key belongs only in the hosted `OPENROUTER_API_KEY` secret. Do not put it in this repository or the Android app.

## HTTP contract

- `GET /api/health` returns `{status:"ok",ai:boolean,model:string}`. `ai` means a hosted key is configured and all required database tables can be read. It does not contact the AI provider or claim the provider is currently available.
- `POST /api/mobile/enroll` accepts only `{installationId:<UUID>,secret:<64 hex characters>}`. The app generates and stores this pair in Android Keystore before enrollment. Existing credentials are idempotent; a different secret for the same installation returns 409. The service stores only the SHA-256 credential hash.
- `POST /api/mobile/chat` reads credentials only from `Authorization: Bearer <64 hex>` and `x-greenbiz-installation: <UUID>`. The strict body is `{requestId:<UUID>,task:"stock"|"sale"|"advice",data:...}`. Successful responses are `{text:string}`. The stock and sale text is validated JSON; advice is short plain text.
- `OPTIONS` is supported on each endpoint. Only the service origin, `https://localhost`, `http://localhost`, `capacitor://localhost`, and `http://127.0.0.1:5173` receive CORS permission. Native and controlled requests without an Origin are accepted. CORS is not authentication.

Task data:

- Stock: `{image:<jpeg/png/webp base64 data URL>}`. The complete encoded string is limited to 5 MiB; the app should compress before sending. Output has at most 20 suggested products with name, category, unit, description, quantity, cost, price, lowAt. Unknown counts/prices are prompted as zero. Quantities have at most three decimals. Photo analysis can make mistakes; Android requires review.
- Sale: `{sentence:<1..1000 characters>,products:[{id,name,unit,available}]}` with at most 500 uniquely identified products. Output `{items:[{productId,quantity}],unmatched:[string]}` must reference supplied IDs, have positive quantities at most available stock, and contain no duplicate IDs. Uncertain matches belong in unmatched.
- Advice: `{question:<1..1000 characters>,aggregates:{income,expenses,net,activeDays,digitalShare,stockItems,lowStockItems}}`. Money is BDT and finite, absolute maximum 1 trillion; only net may be negative. `activeDays` is an integer 0..30, `digitalShare` is a percentage 0..100, and stock counts are integers 0..10000 with lowStockItems no greater than stockItems. No customer, phone, reference, SMS or personal-record fields are accepted. Users should avoid personal details in free text.

All task envelopes and nested objects reject unexpected fields, including model, provider, endpoint, messages and token-budget overrides. Product IDs/names/units are limited to 160 characters. Available stock and output quantities are finite, nonnegative and bounded at 1 billion.

## Provider and failure behavior

Only `https://openrouter.ai/api/v1/chat/completions` is fetched, with redirects returned without following and rejected, a 45-second abort, no retries, nonstreaming output and `max_tokens:2048`. The fixed server request includes `reasoning:{effort:"low"}`. Stock/sale use `response_format:{type:"json_object"}`. Model defaults to `google/gemini-3.8-flash`; provider defaults to `google-ai-studio/flex`, constrained by `provider.only` and `allow_fallbacks:false`. Hosted `OPENROUTER_MODEL` and `OPENROUTER_PROVIDER` can change these server settings.

Upstream errors, exception details, headers and provider bodies are never returned or logged by service code. Only completed, nonempty responses under 16000 characters pass. JSON tasks must pass their output schemas. Direct credential echoes, including Unicode escapes decoded during structured-output normalization, are rejected. Output parsing is bounded to 128 KiB of upstream bytes. Failures return fixed helpful messages. Missing AI configuration returns 503; missing/unavailable database fails closed.

## Durable protection and data

`db/schema.ts` defines three D1 tables; the generated SQL is in `drizzle/`. Set `.openai/hosting.json` to `d1:"DB"`, `r2:null`, keeping the existing project ID. Sites applies the migration during publication; handlers never create tables.

- `installations`: installation UUID, credential SHA-256 hash and creation UTC day.
- `daily_usage`: UTC day, scope, subject and consumed count. IP subjects are SHA-256 hashes, not raw addresses. Cloudflare-supplied CF-Connecting-IP is used; missing addresses share a conservative unknown bucket.
- `request_claims`: installation UUID, request UUID, request-body digest, task, status and creation UTC day. No content or response is stored. A unique claim is durable after quota acceptance and before provider access; exact or altered request-ID reuse returns 409 and never invokes the provider again. A failed or timed-out request requires a new UUID for a new user attempt.

Defaults: 200 AI requests globally per UTC day, 20 per installation, 100 per IP. Optional hosted positive-integer settings `GLOBAL_DAILY_LIMIT`, `DEVICE_DAILY_LIMIT`, `IP_DAILY_LIMIT` are capped at 10000, 1000 and 5000 respectively. Invalid values use defaults. New enrollments have a separate fixed limit of 10 per IP per day; existing matching enrollment can succeed after that cap.

Already exhausted counters are checked before any writes; rejected new request IDs create no durable claims and can be attempted on a later day. Conditional SQL UPSERTs enforce each cap atomically inside a D1 transactional batch. Concurrent races can conservatively consume accepted counters when another counter rejects a mixed reservation, or when an identical concurrent request loses the unique-claim race. Upstream failures also consume quota. This is intentionally conservative. Concurrent enrollment races can also consume an extra enrollment count while preserving the original credential. DB failure after a request claim leaves the claim consumed, preventing duplicate upstream charges.

Credentialless enrollment is **not device attestation**: someone can create new identities, share credentials or use different IPs. The global cap bounds daily request count but is not a monetary spending guarantee because provider token prices and request costs vary. Set provider-side spending controls and monitor usage operationally. The service has no user or administrator controls exposed in its webpage.

The service does not persist or log prompts, images, sale text, business aggregates or AI responses. Selected request content is necessarily transmitted to OpenRouter and the configured provider, whose own processing/retention policies apply. Free-text questions and sale sentences can contain personal details supplied by users; schema checks are structural, not a reliable detector of all personal information. Android should send only intended fields and users should omit personal data. Credential and request metadata currently remain durable; do not delete request claims without accepting the possibility of historical request-ID reuse. Old quota rows can be pruned operationally after their UTC day without restoring today's quota.

## Checks

Use the existing installed dependencies, Node 24 or newer for the `node:sqlite` tests:

```text
npm test
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

Tests execute actual generated schema/SQL against in-memory SQLite, model D1 transactional batches, inject a deterministic clock, and use a controlled fetch transport with a fake test-only credential. They never call a live provider or read a real key. Coverage includes enrollment, authentication, privacy schema, strict fields, concurrent quota claims, same-ID replay, UTC rollover, DB/config failure, provider configuration, timeout/abort, output validation and redaction. Node emits no required external service calls.

The homepage is a small GreenBiz status page. It checks public health only, offers no setup or admin controls, and explains stock, sale, advice and privacy boundaries.
