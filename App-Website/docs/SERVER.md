# GreenBiz server operations

Requires Node.js 24 with built-in `node:sqlite`. Use the checked-in lockfile and `npm ci`. There is no default account, production seed or hardcoded bank login. The API is a single-process Fastify server with a transactional SQLite database on persistent local storage. Do not put the SQLite/WAL files on network shares, cloud-synced folders or ephemeral container filesystems.

## Start locally

In PowerShell, from the project directory:

```powershell
npm ci
$env:DATABASE_PATH = 'C:\private-greenbiz\greenbiz.sqlite'
$env:PUBLIC_ORIGIN = 'http://127.0.0.1:5173'
npm run server
```

Run `npm run dev` in another terminal for Vite. Its `/api` proxy reaches `127.0.0.1:8787`; the browser uses the Vite origin above. For direct API development without Vite, use `http://127.0.0.1:8787` as `PUBLIC_ORIGIN`. The server defaults to host `127.0.0.1`, port `8787`, database `./data/greenbiz.sqlite`. Override with `HOST`, `PORT` and `DATABASE_PATH`. Environment variables must be supplied by the shell/service manager; the server does not automatically load a `.env` file.

The application factory is `await buildApp({dbPath,publicOrigin,...})` in `server/app.ts`. It never listens on import. Tests use Fastify `inject()` against temporary real SQLite files; importing `server/index.ts` also does not listen. Only executing `npm run server` starts the listener.

```powershell
npm test -- shared/domain.test.ts server/app.test.ts server/backup.test.ts
npm run typecheck
```

## Production

Set `NODE_ENV=production` and `PUBLIC_ORIGIN=https://<your-public-host>`. Startup refuses HTTP or a missing public origin in production. Terminate TLS at a maintained reverse proxy, serve the built frontend from that origin, proxy `/api` to this localhost listener, preserve the request `Origin`, and limit request size at the proxy to suit the 7 MB API body maximum. Configure HTTPS correctly before enabling real accounts. A secure public origin string does not itself encrypt traffic; the HTTPS reverse proxy is required.

Use a dedicated OS service account and restrict database/backup directory access to it. These files contain private business data. Secure disks and off-site backups using the deployment's encryption/key-management tools; this application does not encrypt SQLite itself. Restrict administrative shell access. Do not enable request-body/header/URL logging: bearer tokens, cookies and private invoice capability links must not be captured by application or reverse-proxy logs. The application logger is disabled.

Web cookies are `HttpOnly`, `SameSite=Strict`, and `Secure` in production. Session tokens are 32 cryptographically random bytes, hashed with SHA-256 at rest. Passwords use bcrypt cost 12 and a 10-character minimum with a 72-byte UTF-8 maximum. Sessions have a seven-day absolute TTL; logout and logout-all revoke them immediately. The native client receives a token only when explicitly requested and must store it through the Android Keystore-backed integration. No session refresh endpoint exists; sign in again on expiry.

The server validates request ownership and bank roles, strict bounded schemas, origin checks, security headers, and IP rate limits. The process uses no proxy-trust override; behind a reverse proxy, rate limits may apply to the proxy IP. Configure an upstream per-client rate limiter if needed. In-memory limits reset on restart. This server is deliberately single-node; it does not provide horizontal session/rate-limit coordination or a PostgreSQL adapter.

## Create a bank account

Only an administrator with shell/database access can provision a bank user. Supply these values through your secret manager or temporary process environment:

```powershell
$env:DATABASE_PATH = 'C:\private-greenbiz\greenbiz.sqlite'
$env:GREENBIZ_BANK_EMAIL = '<bank-email>'
$env:GREENBIZ_BANK_PASSWORD = '<unique-strong-password>'
npx tsx server/admin.ts create-bank
Remove-Item Env:GREENBIZ_BANK_PASSWORD
```

The command validates the email and password, bcrypt-hashes the password, and inserts a bank role. It refuses duplicate email addresses. It never prints the password. The bank ID always comes from the authenticated account; offer display labels are entered by that provisioned account. Verify the bank's identity before provisioning. No public route grants bank privileges.

## Database migrations

`server/store.ts` opens SQLite with foreign keys, a 5-second busy timeout, WAL and `synchronous=FULL`. It records completed migration versions in `migrations`. Migration 1 is `server/schema.sql`; migrations 2, 3 and 4 are `server/migration-002.sql`, `server/migration-003.sql` and `server/migration-004.sql`. Migration4 adds owned branches while preserving existing default-shop IDs, invoice and bank associations. New files apply missing migrations transactionally. Migration 3 records the exact payment result ID for each new payment request. Older request rows retain a null result: replaying an old rejected claim that needs reassociation fails closed with `409` for merchant review. The server does not guess historical associations. Public reads also reject mismatched invoice/payment links without exposing the payment; an administrator must inspect any such pre-existing corruption against original records. The server refuses a database with a newer schema version. Never edit an already-applied SQL migration in a deployed installation; add a new numbered migration. Back up before upgrading. There is no automatic down-migration.

Tables cover users, workspace JSON, revocable sessions, authoritative offers, price-snapshot order invoices, durable request fingerprints, cross-account transaction-reference claims, and consent-gated expressions of interest. Workspace mutations and related idempotency/claim rows commit together under `BEGIN IMMEDIATE`. SQLite serializes writers. Server retry rows are retained, so repeated sales cannot decrement stock again after the local 2,000-entry retry cache fills. Deleting an account cascades its workspace, sessions, orders, offers, interests and retry/claim metadata.

## Back up and restore

Create a consistent online backup with SQLite's built-in backup API (including committed WAL contents):

```powershell
$env:DATABASE_PATH = 'C:\private-greenbiz\greenbiz.sqlite'
npx tsx server/backup.ts 'C:\private-greenbiz-backups\greenbiz-YYYY-MM-DD.sqlite'
```

Choose a new destination for every backup; existing files are never overwritten. The command verifies `PRAGMA integrity_check` on the copy before reporting success. A failed command may leave a partial destination; inspect it and choose a fresh destination on retry. The test suite verifies a live WAL backup can be read independently with all four migration versions and user data intact. Raw copying only the main file while the server is running can miss WAL transactions; use the supplied backup command or stop the service first.

To restore, stop the GreenBiz service, preserve the current database and any `-wal`/`-shm` companions in a separate recovery folder, then copy a verified backup to a **new** private directory and point `DATABASE_PATH` at that file. Start the server, verify health and a merchant sign-in, and inspect business records before resuming service. Keep the previous copy until the restoration is confirmed. Restore with the same or a compatible newer server version. A backup can contain accounts/data subsequently deleted; set and enforce a retention policy outside the application. Test restoration regularly and store backups separately from the live disk.

## External integrations and release limitations

- AI requires a real `OPENAI_API_KEY` and explicitly selected vision-capable `OPENAI_VISION_MODEL`. These are server environment values, never bundled in Android/browser assets. Images are sent only after a merchant explicitly requests recognition. Review provider privacy terms for your deployment. The adapter calls `https://api.openai.com/v1/chat/completions`, validates output, and times out after 30 seconds. No live provider call is claimed by the automated tests; they exercise the adapter using controlled transport responses.
- bKash verification is unavailable. Transaction IDs are customer claims, and a manual receipt remains `manual`. There is no provider-verification endpoint, fabricated provider receipt or real money movement. An approved provider agreement/adapter and independent integration testing are required before authoritative verification.
- Password recovery is unavailable because this build has no configured delivery adapter, recovery-token flow or reset UI. `/api/auth/forgot-password` returns an actionable `503` and explicitly says no email was sent. Configure and test a real delivery/recovery implementation before offering email reset. Do not display a “sent” confirmation for this state.
- Bank profiles require merchant consent. Offers and expressions of interest are stored records, not underwriting decisions, applications, approvals or disbursements. The internal score is transparent and requires seven actual sale dates; it is not a bureau score.
- Bank document requests create a real persisted merchant activity containing the bank account email and requested message. They require bank role and current merchant consent, commit transactionally, and increment the workspace revision. They do not send email, deliver files or implement a document-upload service.
- This server does not send notification email/SMS, process payments, reconcile a provider feed, or run scheduled backups automatically. Deploy a reachable HTTPS server for multi-device/bank access. APK distribution still requires release signing and appropriate store accounts; iOS signing/building requires Apple's toolchain.
