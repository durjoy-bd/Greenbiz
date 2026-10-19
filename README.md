# GreenBiz — Small Business Copilot for Bangladesh

[![GreenBiz checks](https://github.com/durjoy-bd/Greenbiz/actions/workflows/app-ci.yml/badge.svg)](https://github.com/durjoy-bd/Greenbiz/actions/workflows/app-ci.yml)
[![Latest release](https://img.shields.io/github/v/release/durjoy-bd/Greenbiz?label=release&color=0e5a43)](https://github.com/durjoy-bd/Greenbiz/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-f2a53a)](LICENSE)

An Android app for small shop owners in Bangladesh. It manages inventory and
sales, turns mobile-money SMS (bKash, Nagad, Rocket, Upay) into structured
records **on the phone**, and builds an explainable credit profile that is
matched against 39 published bank loan products.

```
Inventory  →  sale  →  payment SMS  →  linked receipt  →  credit profile  →  matched loan plans
```

| | |
|---|---|
| **Repository** | <https://github.com/durjoy-bd/Greenbiz> |
| **Download the APK** | [Latest release — v2.3.0](https://github.com/durjoy-bd/Greenbiz/releases/latest) |
| **Live web demo** | <https://greenbizdemosite.sustgpt.com> |
| **Managed AI service** | <https://greenbiz-ai-service.dearjelly6.chatgpt.site> |
| **Technical documentation** | [technicaldoc.md](technicaldoc.md) — architecture, core algorithms, security design |
| **Project** | [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Admin console & deployment](App-Website/docs/ADMIN-2.3.md) |

## What it does

**Works on day one with no setup.** Tap *Create my shop* and every record lives
in the app's private storage. Stock, sales, payments, reports, the credit
profile and loan matching all work offline. A cloud account is optional and only
needed for shared records, public invoice links and the bank portal.

**Selling.** Pick products and quantities, or say or type what the customer
bought (*"2 kg rice and 3 soap"*). Quantities can have three decimals, so loose
goods sold by weight work. Every stock check passes before anything is saved,
and a retried sale never takes stock twice. Confirming is a **two-sided swipe**:
right for cash, left for mobile money.

**Mobile-money matching.** The payment sheet shows messages from the **last ten
minutes** first, closest amount first. A bKash or Nagad confirmation rarely
matches the bill exactly, because the customer adds the cash-out charge (about
৳10–20 per thousand). Any receipt within **2% of the bill (at least ৳1)** is
treated as the same payment and labelled, for example, *+৳15 cash-out charge*.
**Look further back** opens the last 30 days. Attaching a message links the sale
to that receipt, so the money is counted once.

**Payment messages stay on the phone.** With the owner's permission, the app
reads payment SMS from known senders only (exact short codes such as `16247`),
ignores OTPs and promotions, picks the transferred amount rather than the fee or
balance, and masks the phone number to its last four digits. The raw message is
never synced or sent to an AI. A *Payment received* notification offers to
create a sale; the amount is hidden on the lock screen.

**Business or personal.** Swipe a receipt right for business or left for
personal. Personal records stay visible but are left out of reports and scores.

**Reports.** This week (weeks start on Saturday), this month, last month,
90 days, this year or any month, in Dhaka time, compared against the previous
period. Best day, top payer, method mix, and CSV export.

**Credit profile and loans.** A 0–100 score from four explained factors —
consistency 30%, volume 25%, stability 25%, activity 20% — with risk flags and
*What to work on*. Loan matching sizes each of the 39 published SME products so
the instalment stays under half of monthly revenue, and labels each as
*High priority* (revenue ≥ 2× the instalment), *Good fit* (1.3–2×) or *Stretch*.

**AI that needs no key.** Product photos, sale sentences and business advice go
to GreenBiz's managed AI service. Users never enter a key or run a server. Every
suggestion is a draft to review, and advice only ever sees totals.

**Accounts and an admin console.** On a GreenBiz server, shop owners sign up and
sign in from the website (or the app once the server has HTTPS), and their records
sync across devices. Platform administrators get a separate console at `/#/admin`:
platform totals and 30-day charts, every shop with its full stock, sales, payments
and activity, account suspension, password resets, sign-out-everywhere, bank users
and more administrators. Every administrator sign-in, record view, export and
account change is written to an audit log, and shop owners are told at sign-up
that administrators can see their records.

**Static website.** `npm run build` produces a folder that runs from any static
host or sub-folder with no server: shops are saved in the browser. Served by a
GreenBiz server, the same files add accounts and the admin console.

**Honest by design.** A TrxID is a customer's claim, not proof of payment, and
nothing in the app can mark a payment *verified*. Scores are labelled
self-recorded estimates, not bureau scores or loan approvals.

## Repository layout

| Path | What it is |
|---|---|
| [`App-Website/`](App-Website/) | The Android app (Capacitor + React), the responsive web app, the optional cloud portal API (Fastify + SQLite), database migrations, tests and deployment templates |
| [`App-Website/shared/`](App-Website/shared/) | The domain engine and algorithms shared by the phone, the browser and the server |
| [`App-Website/android/`](App-Website/android/) | Android project, including the native SMS, Keystore and speech plugins |
| [`Managed-AI-Service/`](Managed-AI-Service/) | The hosted AI service: Cloudflare Workers + D1, quotas and request validation |
| [`technicaldoc.md`](technicaldoc.md) | Full technical documentation |
| [`Presentation/`](Presentation/) | Presentation decks (PowerPoint) with speaker notes |
| [`START-HERE.md`](START-HERE.md) | Short orientation to the two projects |
| [`.github/workflows/`](.github/workflows/) | CI: lint, typecheck, tests, builds, browser journeys, Android build |

More documentation:

- [`technicaldoc.md`](technicaldoc.md) — system architecture, core algorithms, security design, permission tiers, known risks
- [`App-Website/docs/API.md`](App-Website/docs/API.md) — every API contract
- [`App-Website/docs/SERVER.md`](App-Website/docs/SERVER.md) — server operations, migrations, backup and restore
- [`App-Website/docs/RELEASE.md`](App-Website/docs/RELEASE.md) — release checklist
- [`App-Website/docs/VALIDATION.md`](App-Website/docs/VALIDATION.md) — recorded validation results
- [`App-Website/docs/FEATURES-2.1.md`](App-Website/docs/FEATURES-2.1.md) — features restored from GreenBiz 1.x
- [`App-Website/docs/MOTION-2.2.md`](App-Website/docs/MOTION-2.2.md) — 2.2 animations, transitions and haptics
- [`Managed-AI-Service/README.md`](Managed-AI-Service/README.md) — AI service contracts and quotas

## Requirements

- **Node.js 24** or newer (the portal uses the built-in `node:sqlite`)
- **Java 17** and **Android SDK** platform 36 / build-tools 36, for Android builds
- A Linux server with a domain name, only for hosting the cloud portal
- A Cloudflare account and an OpenRouter key, only for hosting your own AI service

## Quick start (local)

Two processes: the API and the web app.

```powershell
cd App-Website
npm ci

# Terminal 1 — the API on http://127.0.0.1:8787
$env:PUBLIC_ORIGIN = 'http://127.0.0.1:5173'
$env:DATABASE_PATH = './data/greenbiz.sqlite'
npm run server

# Terminal 2 — the app on http://127.0.0.1:5173
npm run dev
```

Open <http://127.0.0.1:5173>. Choose **Create my shop** for a device shop, or
register a cloud account (leave the *Business server* field blank to use the
same-origin proxy). There are no default credentials.

## Deployment

### 1. Android app

```powershell
cd App-Website
npm ci
npm run android:sync          # builds the web app and copies it into Android
cd android
.\gradlew.bat assembleDebug   # -> app/build/outputs/apk/debug/app-debug.apk
```

For a signed release, supply your own keystore through environment variables
(never commit it), then build the bundle:

```powershell
$env:GREENBIZ_KEYSTORE = 'C:\private\greenbiz-release.jks'
$env:GREENBIZ_STORE_PASSWORD = '...'
$env:GREENBIZ_KEY_ALIAS = '...'
$env:GREENBIZ_KEY_PASSWORD = '...'
.\gradlew.bat bundleRelease   # -> app/build/outputs/bundle/release/app-release.aab
```

The app identifier is `com.greenbiz.app` (min API 23, target API 36). Keep the
same identifier and signing key for every update so users keep their data.

### 2. Cloud portal — Linux server with nginx and systemd

This is how the live demo is hosted.

**Build** on any machine with Node 24:

```bash
cd App-Website
npm ci
npm run build            # web app  -> dist/
npm run build:server     # API      -> server-dist/
```

**Install** on the server:

```bash
sudo useradd --system --home /opt/greenbiz greenbiz
sudo mkdir -p /opt/greenbiz/app /var/lib/greenbiz /var/www/greenbiz
sudo cp -r server-dist package.json package-lock.json scripts /opt/greenbiz/app/
cd /opt/greenbiz/app && sudo npm ci --omit=dev
sudo chown -R greenbiz:greenbiz /opt/greenbiz /var/lib/greenbiz
sudo chmod 700 /var/lib/greenbiz
sudo cp -r dist/* /var/www/greenbiz/           # static web app
```

**Run the API** as a service — `/etc/systemd/system/greenbiz-api.service`:

```ini
[Unit]
Description=GreenBiz API
After=network.target

[Service]
User=greenbiz
WorkingDirectory=/opt/greenbiz/app
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=8787
Environment=PUBLIC_ORIGIN=https://greenbiz.example.com
Environment=DATABASE_PATH=/var/lib/greenbiz/greenbiz.sqlite
ExecStart=/usr/bin/node server-dist/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now greenbiz-api
```

**Serve it over HTTPS** with nginx. The static app is served from disk and only
`/api/` reaches Node. Keep access logs off for `/api/`, because requests carry
session tokens and private invoice links.

```nginx
server {
    listen 443 ssl http2;
    server_name greenbiz.example.com;
    # ssl_certificate / ssl_certificate_key from Let's Encrypt (certbot)

    root /var/www/greenbiz;
    client_max_body_size 8m;

    location /api/ {
        access_log off;
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header Origin $http_origin;
    }
    location / {
        try_files $uri /index.html;
    }
}
```

**Check it:**

```bash
curl https://greenbiz.example.com/api/health
# {"status":"ok","ai":false,"bkashVerification":false,"passwordRecovery":false,"persistence":"sqlite"}
```

The server refuses to start in production without an `https://` `PUBLIC_ORIGIN`.

**Create a bank user** (there is no public way to become a bank):

```bash
cd /opt/greenbiz/app
sudo -u greenbiz env DATABASE_PATH=/var/lib/greenbiz/greenbiz.sqlite \
  GREENBIZ_BANK_EMAIL='bank@example.com' GREENBIZ_BANK_PASSWORD='<strong password>' \
  node server-dist/admin.js create-bank
```

**Back up** with SQLite's online backup (safe while running; never overwrites):

```bash
sudo -u greenbiz env DATABASE_PATH=/var/lib/greenbiz/greenbiz.sqlite \
  node server-dist/backup.js /var/backups/greenbiz-$(date +%F).sqlite
```

### 3. Cloud portal — shared VPS with Docker (recommended)

A self-contained stack for a VPS that already hosts other sites: two memory-capped
containers (Caddy for the website, Node 24 for the API) on one spare port, with no
`npm install` on the server, nightly verified backups and a one-command update:

```bash
cd App-Website
./deploy/vps/deploy.sh <ssh-host>     # builds, uploads, restarts, checks health
```

First-time setup, creating the first administrator, backups, restore and switching
on HTTPS are covered in [App-Website/deploy/vps/README.md](App-Website/deploy/vps/README.md).

### 4. Cloud portal — single-host Docker with a domain

```bash
cd App-Website
npm ci && npm run build
cd deploy
GREENBIZ_DOMAIN=greenbiz.example.com docker compose up -d --build
```

Caddy obtains the TLS certificate, serves `dist/` and proxies `/api` to the API
container. Data lives in the `business_data` volume.

### 5. Managed AI service (optional — the app already uses the hosted one)

```bash
cd Managed-AI-Service
npm ci
npm test
npm run build
```

Deploy to Cloudflare Workers with a D1 database bound as `DB` and apply the
migration in `drizzle/`. Set `OPENROUTER_API_KEY` as a hosted secret, never in
source or the APK. Optional settings: `OPENROUTER_MODEL`, `OPENROUTER_PROVIDER`,
`GLOBAL_DAILY_LIMIT`, `DEVICE_DAILY_LIMIT`, `IP_DAILY_LIMIT`. To point the app at
your own service, build it with `VITE_GREENBIZ_AI_SERVICE=https://your-service`.

## Test cases

Run everything:

```powershell
cd App-Website
npm run lint                  # ESLint, zero warnings
npm run typecheck             # strict TypeScript
npm test                      # 116 unit and API tests
npx playwright install chromium
npm run test:ui               # 25 browser journeys (API from Quick start must be running;
                              # set E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD for the 2 admin journeys)
cd android
.\gradlew.bat testDebugUnitTest   # 4 native SMS parser tests

cd ..\..\Managed-AI-Service
npm test                      # 24 AI service tests
```

Results on 2026-10-19 (v2.3.0): **169 tests, all passing**: 116 unit/API,
25 browser journeys (including the admin console), 4 native SMS parser tests and
24 AI service tests.

| Suite | Tests | What it proves |
|---|---:|---|
| `server/admin.test.ts` | 8 | Administrators are separate from shop owners; every shop is visible with full records; views and changes are audited; suspension, password reset, deletion confirmation, bank users, owner password change, HTTP only by explicit opt-in |
| `shared/domain.test.ts` | 27 | Sales are atomic; a retried sale never takes stock twice; reused request IDs are refused; money rounds exactly; dates use Dhaka time; receipts link only inside the cash-out band |
| `shared/sms.test.ts` | 14 | The received amount is picked, never the balance; Bengali digits and Bangla wording parse; only exact short codes are trusted; the same payment imports once |
| `shared/loans.test.ts` | 13 | EMI and its inverse are correct; suggested amounts stay under half of revenue and inside a real product band; the 39-product catalogue loads |
| `shared/credit-profile.test.ts` | 6 | Weights are 30/25/25/20; volume scores against ৳20,000; risk flags fire; personal and foreign records are left out |
| `shared/tolerance.test.ts` | 6 | Exact, cash-out and distant amounts are labelled correctly |
| `shared/finance.test.ts` | 4 | Linked sales count once; periods compare correctly; calendar presets start weeks on Saturday |
| `shared/sale-entry.test.ts` | 2 | Spoken or typed sales never invent a match or a quantity |
| `server/app.test.ts` | 27 | Passwords and tokens are hashed; cookies are HttpOnly and SameSite; cross-origin writes are refused; shops are isolated; offline replay is exact-once; invoice claims cannot change the amount; banks see only consenting shops |
| `server/store.test.ts`, `backup.test.ts` | 2 | Migrations preserve old data; a live database backs up consistently |
| `src/data/*.test.ts` | 7 | Offline creates keep stable IDs; AI only receives aggregates; AI-suggested product IDs are checked |
| `tests/*.spec.ts` (Playwright) | 23 | End-to-end in a real browser: device shop, multi-shop isolation, SMS-linked sale, offline restart, conflict handling, cash-out attach, loan directory, reports, phone-width layouts |
| `Managed-AI-Service/tests` | 24 | Credentials are hashed; quotas hold under concurrency; a request is never sent twice; redirects and credential echoes are rejected; failures reveal nothing |
| `SmsPaymentParserTest.java` | 4 | The native Android parser matches the TypeScript rules |

Every push runs the same checks on GitHub Actions.

## Secrets never enter the repository

`.gitignore` blocks credential files outright, so a stray `git add -A` cannot
ship one:

| Blocked | Why |
|---|---|
| `.env`, `.env.*` | Server configuration and AI keys. Only `App-Website/.env.example`, with empty values, is committed. |
| `*.jks`, `*.keystore`, `*.pem` | Android signing keys and certificates |
| `*.db*`, `*.sqlite*`, `/data/` | Business databases |
| `node_modules/`, `dist/`, `server-dist/`, Android `build/` | Generated output |

- **AI key:** the OpenRouter key exists only as a hosted secret on the AI
  service. The APK contains just the service's public address.
- **Sessions:** tokens are stored encrypted with an Android Keystore key on the
  phone and only as SHA-256 hashes on the server.
- **Bank users:** created only from the server shell. There is no default
  account or password anywhere in the code.

## What is deliberately not built

- **Automatic payment verification.** There is no approved bKash or Nagad API
  integration, so a TrxID or SMS is never presented as proof of payment.
- **Loan applications or disbursement.** Matching uses published terms; a bank
  offer and an expression of interest are records, not approvals.
- **Insurance products.** The advisor accepts insurance questions, but no
  insurer products are in the catalogue.
- **Password recovery by email.** No mail service is configured, and the app
  says so instead of pretending to send an email.
- **Full Bengali interface.** Bengali text, digits and ৳ display correctly, but
  the interface copy is English.
- **iOS.** Android only.

## License

GreenBiz is open source under the [MIT License](LICENSE).
