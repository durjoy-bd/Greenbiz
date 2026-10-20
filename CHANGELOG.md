# Changelog

All notable changes to GreenBiz. Versions follow the Android `versionName`; each is published as a [GitHub release](https://github.com/durjoy-bd/Greenbiz/releases).

## [2.4.0] — 2026-10-20

### Added
- **Account system.** Sign-up with full name and password confirmation, email confirmation links, show/hide password, forgotten-password links (single use, 30 minutes), field-by-field validation messages, and a return to the page you asked for after signing in.
- **Profile & account page.** Name, photo, phone, location and organisation; email with confirmation status and a confirmed email change; password change; every active session with sign-out of one or all others; account type, role and status.
- **Roles.** User, Admin and Super Admin, checked on the server for every admin request. Administrators are now ordinary accounts; the last active Super Admin is protected; public sign-up always creates a User.
- **Two-step verification** (authenticator app, with ten recovery codes) for the admin panel.
- **Admin panel** at `/admin`: a dashboard with date ranges, registrations, confirmed and unconfirmed accounts, account status, daily and monthly active users with a stated definition; a server-side searchable, filterable, sortable and paged user table; a page per user with profile, account, activity, related shops and offers, and administrative history; confirmation dialogs with required reasons; bank-user invitations by email.
- **Activity log** of account, security and shop events with search, user, event, result and date filters, a retention period, and an honest "not recorded" for days before 2.4.
- **Audit trail** with before-and-after values, reasons and outcomes (including refused attempts). The database rejects any change or deletion.
- **Settings** for Super Admins: email delivery (SMTP) with a test email, the email-confirmation requirement and activity retention, applied without a restart.
- Server commands `create-super-admin`, `promote-super-admin`, `reset-mfa`, and `--demo` for a password-only public demo administrator.
- Server settings `SMTP_*`, `MAIL_FROM`, `MAIL_TRANSPORT`, `REQUIRE_EMAIL_VERIFICATION`, `ACTIVITY_RETENTION_DAYS` and `TRUST_PROXY`. Five wrong passwords for one email from one address lock that pair for 15 minutes; 50 from any addresses lock the email.

### Changed
- Administrators send a password reset link instead of creating a temporary password they could see.
- Bank users are invited by email and choose their own password.
- Welcome screen: **Create an account** and **Sign in** when a server is available; an account menu with *Profile & account*, *Admin panel* (for administrators) and *Sign out*.

### Android app
- `GreenBiz-2.4.0.apk` (versionCode 6) is preset to the demo server, so sign-in and sign-up need no server address. It is signed like 2.3 and installs as an update.
- *Admin panel* in the app's account menu opens the server's `/admin` page in the phone's browser, because the panel's sign-in cookie and two-step check work only in a browser.

### Project
- Project website at <https://durjoy-bd.github.io/Greenbiz/>, deployed from `site/` by GitHub Pages.
- Repository tidied: one presentation deck, no binaries in git; the APK and the demo video are release downloads.
- Technical documentation, README and test matrix updated for 2.4 (217 tests).

### Upgrade notes
- Migration 6 converts 2.3 administrators into Super Admin accounts (same email and password) and flags any email that clashes with a customer account for review instead of merging it. See [docs/ACCOUNTS-2.4.md](App-Website/docs/ACCOUNTS-2.4.md).

## [2.3.0] — 2026-10-20

### Added
- **Admin console** at `/#/admin` for the people who run a GreenBiz server:
  - Platform overview with 30-day sales and sign-up charts.
  - Every shop's full stock, sales, payments, invoices and activity, with CSV and JSON export.
  - Account controls: suspend, restore, sign out everywhere, reset password, delete, create bank users and administrators.
  - Activity feed, audit log and system status.
- Administrators are kept separate from customer accounts, with their own session cookie scoped to `/api/admin`. Every sign-in, record view, export and account change is audited.
- Shop owners can change their password. Suspended accounts are blocked at sign-in and on every request, and last sign-in is tracked.
- New sign-ups are told that administrators can view their records.
- Static website build with relative asset paths, so it runs from any host or folder with no server.
- `deploy/vps`: a self-contained server bundle, a memory-capped Docker stack on one port, a one-command deploy script, nightly verified backups and an operations guide.
- Server settings `ALLOW_INSECURE_HTTP` and `AUTH_RATE_LIMIT_MAX`, and the build-time default `VITE_GREENBIZ_SERVER`.

### Changed
- When the website is served by a GreenBiz server, the welcome screen offers **Sign in or create an account** directly.
- Plain-HTTP deployments work thanks to fallbacks for browser crypto functions that exist only on HTTPS.

## [2.2.0] — 2026-10-19

### Added
- A motion system:
  - Native page transitions, spring sheets with drag-to-close, and a live-drag swipe-to-confirm.
  - Payment rows that drag to reveal *Business* or *Personal*.
  - Counting numbers, animated charts, meters and gauge, and a success moment after each sale.
  - Frosted navigation with an indicator pill, layered surfaces, and haptics.
- Settings → *Reduced motion*, which turns all of it off.

## [2.1.0] — 2026-10-19

### Added (restored from GreenBiz 1.x)
- Mobile-money matching with the cash-out band (2% of the bill, at least ৳1): last-10-minutes suggestions, *Look further back*, method chips, and *The totals do not match* → *Record separately*.
- Live *Payment received* prompts and notifications, and a receipt after each sale.
- The 0–100 credit profile (consistency 30%, volume 25%, stability 25%, activity 20%) with risk flags and *What to work on*.
- 39 published Bangladeshi SME loan products matched to recorded revenue, labelled *High priority*, *Good fit* or *Stretch*.
- Calendar report periods, best day/week/month, top payers, quick restock, Upay, and more SMS formats including short codes and Bangla amounts.

## [2.0.0] — 2026-10-19

- React and Capacitor rebuild: multiple shops, fractional stock, voice/text checkout, SMS review, business and personal transactions, reports, managed AI and an optional cloud portal.

[2.4.0]: https://github.com/durjoy-bd/Greenbiz/releases/tag/v2.4.0
[2.3.0]: https://github.com/durjoy-bd/Greenbiz/releases/tag/v2.3.0
[2.2.0]: https://github.com/durjoy-bd/Greenbiz/releases/tag/v2.2.0
