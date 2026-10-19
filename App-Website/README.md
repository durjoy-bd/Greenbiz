# GreenBiz

An Android small-business app based on the supplied Puji designs, renamed GreenBiz. Includes the merchant phone UI, responsive shop dashboard, public invoice/payment page, and private bank portal.

## Try the Android app

The delivered `GreenBiz-2.1.0.apk` is an installable **internal/testing build**, signed with the local Android debug certificate. Transfer it to your Android phone, open it, and allow installation from that file source if Android asks. It requires Android 6.0 or newer and a current Android System WebView. It has not been installed on your personal phone as part of this build.

- **Create my shop:** an empty, real shop whose stock, sales, payment reviews and settings persist in this app’s private device storage. No account or internet is needed for these tools. Export backups from Settings; uninstalling/clearing app data removes the device shop.
- **Explore sample shop:** separate fictional reference records. Nothing in this mode verifies a payment, contacts a lender, or changes your own shop.
- **Optional bank & cloud portal:** real accounts, shared records, public customer links and bank offers. An owner-operated HTTPS service is required for these optional tools. Existing device records are not automatically uploaded, merged, or synchronized into a server account.

The UI supports Bengali text and the taka sign with bundled fonts. Interface copy is currently English; a full Bengali translation is not implemented.

## What works

New in 2.1: the GreenBiz 1.x features 2.0 left out are back — mobile-money payment matching with the cash-out charge band, live “Payment received” prompts, sale receipts, the 0–100 credit profile, 39 published bank loan plans matched to your revenue, calendar report periods with best day and top payers, quick restock, Upay and more Bangladeshi SMS formats. See [2.1 restored features](docs/FEATURES-2.1.md).

New in 2.0: multiple shops, fractional stock/restock, voice/text checkout, SMS review/import/alerts, business/personal transactions, expenses, period reports, borrowing planner, premium motion and managed AI. The main Android app works locally without a business server. Optional cloud accounts support durable offline queues and explicit conflict resolution.

Inventory create/edit/delete/search/filter and low-stock reminders; atomic sales with stock deduction, duplicate-request protection and historical product snapshots; derived dashboards and CSV exports; payment claims, duplicate-reference checks and manual review; activity history; consent-controlled internal business indicator; actual bank-user offers and expressions of interest; public invoice links that expose only one invoice; camera/photo selection with manual product entry; centrally managed AI, optional personal AI providers; native secure session storage and native record export/share.

**Payment honesty:** entering a TrxID does not verify receipt. Recording a bKash sales method does not verify receipt. Manual checks remain labelled manual. An approved bKash provider adapter is **not connected or implemented** in this delivery, so real automatic verification is unavailable. The verified sample row is explicitly fictional.

**Financing honesty:** the score is a transparent GreenBiz internal indicator, not a bureau score or bank approval. Live shops start without offers. A bank account must be provisioned by your administrator. Expressing interest is not a completed loan application or money disbursement.

**AI:** normal users use GreenBiz’s managed AI online, with no API key, account or business-server setup. The owner’s OpenRouter key remains a hosted secret. Photo, sale and advice suggestions need review; personal payments and raw SMS are excluded from advice. Advanced personal AI settings and the optional legacy server adapter remain available. See [2.0 features and privacy](docs/FEATURES-2.0.md).

## Optional cloud portal source

These developer steps support shared accounts, invoices and the bank portal. Android users do not perform them.

Requires Node 24. Install dependencies with `npm ci`.

```powershell
# Terminal 1, from this directory
$env:PUBLIC_ORIGIN = 'http://127.0.0.1:5173'
$env:DATABASE_PATH = './data/greenbiz.sqlite'
npm run server

# Terminal 2
npm run dev
```

Open `http://127.0.0.1:5173`. For a server account, leave the Business server field blank to use the same-origin proxy. Bank accounts use the same sign-in form and are routed to the lending desk after authentication. There are no default credentials.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run build:server
npx playwright install chromium
npm run test:ui
```

Browser tests need the temporary API running with the Vite public origin. Keep test databases separate from production. Domain/API tests use isolated temporary SQLite databases.

## Build Android

Requires Java 17, Android SDK platform 36/build-tools 36, and the checked-in Gradle wrapper. Set `ANDROID_HOME` or create your machine’s ignored `android/local.properties`. The app targets API 36.

```powershell
npm run android:sync
cd android
.\gradlew.bat assembleDebug bundleRelease --no-daemon
```

The release AAB remains unsigned unless your own release-signing environment is supplied. Never publish the internal debug APK as a Play release. The tiny checked-in Capacitor CLI compatibility patch lets the pinned Java-17-compatible runtime use patched node-tar; dependency audit was checked after this adaptation. Fonts are bundled for offline rendering.

## Deployment and limits

See [server operations](docs/SERVER.md), [API contracts](docs/API.md), [release requirements](docs/RELEASE.md), and [validation results](docs/VALIDATION.md).

Managed AI is hosted separately for ordinary app users. Optional bank/cloud portal hosting, domain/TLS, database operations/backups, payment-provider contracting, email recovery, and Play signing/store ownership still require owner operation. The supplied Docker/Caddy templates are preparation, not a verified deployment. Password-reset email intentionally reports unavailable because no mail delivery service is configured. The backend uses single-node persistent SQLite rather than PostgreSQL; see its operational constraints before scaling. No iOS binary or iOS native secure-store implementation is included; this delivery targets the Android request.

Device exports are readable JSON/CSV backups; an automatic import/merge UI is not included. Server accounts use their server’s backup/restore process. There is no automatic device-to-server migration, remote push-notification service, official bank/bKash connection, or store publication.
