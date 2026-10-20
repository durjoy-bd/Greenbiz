# GreenBiz 2.0 validation — 19 October 2026

## Executed checks

| Check | Result |
| --- | --- |
| App domain/API/backup/client tests | 79 passed across 10 files |
| Managed AI service tests | 24 passed; actual SQLite schema/SQL, controlled provider transport |
| Browser journeys | 17 passed; final full run 1.3 minutes |
| TypeScript / ESLint | Passed; zero app lint warnings |
| Production web/server bundles | Built successfully |
| Android | Debug APK, release AAB, three JVM SMS parser tests and lintDebug passed |
| APK identity | GreenBiz, com.greenbiz.app, version 2.0.0 / code 2; min API 23, target/compile API 36 |
| Signing | APK debug signature verified; AAB unsigned |
| Dependency audit | Production dependencies: zero reported vulnerabilities |
| Visual review | 14 screenshots, no browser page errors; phone finance and sale layouts reviewed |
| Responsive checks | Existing and new screens fit 320/390px; desktop 1440px reviewed |
| APK secret check | Managed HTTPS origin bundled; no OpenRouter secret pattern in bundled JavaScript |

Browser journeys cover device persistence, isolated shops, SMS receipt linking to fractional sales, expenses/reports, lost-response exact-once replay, offline restart, conflict export/discard, expired-session reconnect, uncached failed branch switching, fractional decrement, reduced motion, account deletion/cache purge, late old-shop success/error isolation, draft isolation, serialized writes, authentication and public invoice corrected-reference/manual-review behavior.

App tests cover money/quantities, stock atomicity, multi-shop ownership and migration 4, transactions/currencies/linking and hashed retry metadata, sync envelopes/stable IDs/timestamps, parser filtering, report calculations, borrowing assumptions, managed client request scope, authentication, bank consent/offers/interest/document requests and consistent WAL backups. Provider adapter tests use controlled responses.

Managed service tests cover strict enrollment/auth/task contracts, hashed credentials, fixed provider/model/endpoint, request claim replay/concurrency, per-device/global/IP limits, rejected-request storage abuse, UTC rollover, fail-closed configuration/database behavior, 45-second timeout, request/output bounds, structured sale/stock validation, credential echo rejection and safe upstream error categories. Independent final review approved original store/replay/rounding corrections and the quota fix.

## Managed AI deployment and live verification

Public service: https://greenbiz-ai-service.dearjelly6.chatgpt.site

The owner key/model/provider are hosted secrets; no provider credential is in application source or the APK. Saved service version 4, source 5b57b15374e8ebbc2cb77db3e7d921c884c548e1, deployment appgdep_6ad590999780819181b6d56aa1dbd743: publication succeeded with environment revision 1 and D1 migration applied. Anonymous Android-origin health and enrollment returned 200 with matching CORS. Health reports configured/migrated readiness and does not assert a successful model request. After correcting an actual Workers runtime incompatibility (unsupported redirect:error), live advice, sale and stock requests all returned 200 with the requested Gemini 3.8 Flash / Flex route and Android-origin CORS. Advice used fictional aggregates, sale matching returned the supplied demo-rice ID at 1.5 kg, and a blank 1 px PNG returned an empty products list. This validates the live image pipeline, not product-recognition accuracy on real shop photos. The app preserves manual/offline tools when AI is unavailable. An actual workerd transport regression and 301/302/307/308 rejection coverage now guard the correction.

## Boundaries

- No installation on the user's phone or physical-device SMS, notifications, speech, camera/gallery, keyboard/insets, secure-storage lifecycle, low-storage or accessibility-service checks.
- APK is an internal/testing build. Owner release signing and Play submission have not been performed; SMS permissions need store eligibility review.
- Optional bank/cloud business portal and Docker templates were not publicly deployed. Its real accounts/invoices require owner operation; normal Android shops need no business server.
- No official bKash verification, bank/insurer partnership, mail recovery delivery, loan approval or disbursement is claimed. SMS/claims/manual review are not provider-authoritative payment verification.
- Full Bengali UI translation, automatic export import/merge and device-to-server migration are not implemented. Back up device exports before uninstall/clear-data.

Nonfatal generated Capacitor/Gradle deprecation/flatDir warnings, APK META-INF signature warnings and Vite mixed-import notices remain. Android lint completed successfully. No physical-device performance guarantee is inferred from workstation tests.

## GreenBiz 2.1.0 (19 October 2026)

Restores the GreenBiz 1.x features listed in [FEATURES-2.1.md](FEATURES-2.1.md).

- `npm run lint`, `npm run typecheck`, `npm run build` and `npm run build:server` succeeded.
- `npm test`: 108 unit/API tests passed (13 files).
- `npx playwright test`: 23 browser journeys passed against this build's Vite and API servers on ports 5174/8788 (`GREENBIZ_DEV_PORT`, `GREENBIZ_API_ORIGIN`).
- `gradlew assembleDebug testDebugUnitTest`: build successful; 4 native SMS parser tests passed.
- APK `GreenBiz-2.1.0.apk`: `com.greenbiz.app`, versionCode 3, versionName 2.1.0, debug-signed for internal testing. SHA-256 `2971ec6d5f8ac7e8238e95c775a9ce2b11ff7a37849fca467556df2bb7147afa`.
- Not performed: release signing/AAB, Android lint, and physical-device checks of live SMS, notifications, speech and camera. The loan catalogue figures are published terms as of 18 October 2026, not lender quotes.

## GreenBiz 2.2.0 (19 October 2026)

Motion and visual finish; see [MOTION-2.2.md](MOTION-2.2.md). No change to records, sync or calculations.

- Lint, typecheck, web and server builds succeeded. 108 unit/API tests passed.
- 23 browser journeys passed against this build (ports 5174/8788). A separate check confirmed View Transitions run in Chromium with no console errors across tab and sub-page navigation. Phone-width checks pass at 320 px.
- `gradlew assembleDebug testDebugUnitTest` succeeded; 4 native parser tests passed.
- APK `GreenBiz-2.2.0.apk`: versionCode 4, versionName 2.2.0, debug-signed. SHA-256 `2fa204021350fa8f954dfe43de6a4fe3dd5cc5fcdbd696b0cea90602de1bae72`.
- Not performed: frame-rate profiling or haptics on a physical phone. View Transitions need Android System WebView 111 or newer; older WebViews use the CSS fallback.

## GreenBiz 2.3.0 (19 October 2026)

Accounts, admin console, static website and VPS deployment; see [ADMIN-2.3.md](ADMIN-2.3.md).

- Lint, typecheck, web build and standalone server bundle succeeded. The bundle runs in an empty folder with no `node_modules`.
- `npm test`: 116 unit/API tests passed, including 8 admin and account-security tests.
- 25 browser journeys passed against this build, including the admin console journey (sign in, open a shop's records, reset an owner's password, audit entries) and a phone-width check.
- Deployed to the shared VPS as two Docker containers on port 8790 (API 256 MB and web 128 MB caps; about 32 MB and 44 MB in use). Health, website and admin sign-in verified over the public internet. A real browser over plain HTTP opened a device shop and the admin console with no console errors. A verified backup was taken and a nightly backup job installed. No existing site, nginx configuration or port-80/443 forwarding was changed; only firewall port 8790 was opened.
- `gradlew assembleDebug testDebugUnitTest` succeeded; 4 native parser tests passed. APK `GreenBiz-2.3.0.apk`: versionCode 5, versionName 2.3.0, debug-signed. SHA-256 `d502e8531cd01f9367c78d46352e8f1cd7d1cb51668ba3478d2c685e55ff57d6`.
- Not done: HTTPS (no domain yet), so the deployment is for testing. The Android app cannot sign in to an HTTP server. No physical-device test.

## GreenBiz 2.4.0 (20 October 2026)

Accounts, roles, the admin panel, activity tracking and the audit trail; see [ACCOUNTS-2.4.md](ACCOUNTS-2.4.md).

- Lint, typecheck, web build, server bundle and `npm audit --audit-level=high` (0 vulnerabilities) succeeded.
- `npm test`: 139 unit/API tests passed, including 15 account tests and 16 admin tests.
- 30 browser journeys passed against a real API with the development email outbox. They found three interface bugs, all fixed: the show/hide button was read as part of the password label, the eye icon jumped when pressed, and the welcome buttons could swap under a tap.
- Deployed to greenbizdemosite.sustgpt.com after a verified database backup (the database was empty). Migrations 5 and 6 ran on start. A demo Super Admin was created with `create-super-admin --demo` at the owner's request. Admin sign-in, dashboard, users and settings were checked in a real browser over HTTPS, and the Android app's request pattern (native origin, bearer token: sign-up, profile, sessions, shop records, account deletion) was checked against the live server with a throwaway account that was then deleted.
- `gradlew testDebugUnitTest assembleDebug` succeeded; 4 native parser tests passed. APK `GreenBiz-2.4.0.apk`: versionCode 6, versionName 2.4.0, debug-signed with the same certificate as 2.3 (SHA-256 `d6eba623…0809`), preset to the demo server. SHA-256 of the APK `160ef81782a2521f31232c225665b5e14bc6e3ccbaa03a050460219fb3a8e247`.
- Not done: no emulator or phone was available, so the APK was not installed on a device. Email delivery on the demo server is not configured yet, so email confirmation is switched off there.
