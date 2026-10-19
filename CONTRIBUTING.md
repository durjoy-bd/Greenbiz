# Contributing to GreenBiz

Thanks for helping. This guide covers setup, checks and releases.

## Project layout

| Folder | What it is |
| --- | --- |
| `App-Website/` | Android app, website, admin console, API server, deployment kit and tests |
| `Managed-AI-Service/` | The hosted AI service the app uses with no key |
| `Presentation/` | Pitch decks and notes |

## Setup

Requires Node 24, plus Java 17 and the Android SDK (platform 36) for Android builds.

```bash
cd App-Website
npm ci
PUBLIC_ORIGIN=http://127.0.0.1:5173 npm run server   # API on :8787
npm run dev                                          # app on :5173
```

Create a local administrator for `/#/admin`:

```bash
GREENBIZ_ADMIN_EMAIL=you@example.com GREENBIZ_ADMIN_PASSWORD='Choose-a-strong-1' npx tsx server/admin.ts create-admin
```

## Before opening a pull request

```bash
npm run lint && npm run typecheck && npm test && npm run build
npx playwright test          # needs the API running; admin journeys need E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD
cd android && ./gradlew testDebugUnitTest
```

CI runs all of this on every pull request.

House rules:

- **Money** stays in integer poisha arithmetic. Quantities have at most three decimals.
- **Privacy:** raw SMS never leaves the device or reaches AI. AI advice sees aggregates only.
- **Honesty:** nothing may claim a payment is *verified*, a loan *approved*, or a score is a *bureau* score.
- **Motion** is decoration and must respect reduced motion.
- **Admin:** every new admin action writes an audit entry.
- **Schema changes** go in a new `server/migration-00N.sql`. Never edit an applied migration.

## Releasing

1. Bump `versionName`/`versionCode` in `App-Website/android/app/build.gradle`, `version` in `App-Website/package.json` and `package-lock.json`, and the label in `Settings.tsx`.
2. Add the version to `CHANGELOG.md`.
3. Build the APK on the release machine (`npm run android:sync`, then `gradlew assembleDebug`). The same signing key must be used each time so updates install over the previous version.
4. Publish a GitHub release tagged `vX.Y.Z` with the APK and its `.sha256`. The *Release bundles* workflow then attaches the static website zip and the VPS package automatically.
5. Update a server with `App-Website/deploy/vps/deploy.sh <ssh-host>`.
