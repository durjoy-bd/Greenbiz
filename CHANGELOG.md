# Changelog

All notable changes to GreenBiz. Versions follow the Android `versionName`; each is published as a [GitHub release](https://github.com/durjoy-bd/Greenbiz/releases).

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

[2.3.0]: https://github.com/durjoy-bd/Greenbiz/releases/tag/v2.3.0
[2.2.0]: https://github.com/durjoy-bd/Greenbiz/releases/tag/v2.2.0
