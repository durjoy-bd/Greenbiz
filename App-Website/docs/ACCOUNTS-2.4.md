# GreenBiz 2.4: accounts, roles and the admin panel

This guide is for the people who run a GreenBiz server. It covers what 2.4 adds, how to set up email and the first Super Admin, and how the admin panel works. It replaces the account parts of [ADMIN-2.3.md](ADMIN-2.3.md).

## What changed

| Area | 2.3 | 2.4 |
| --- | --- | --- |
| Sign-up | Email, password, shop | Full name, email, password + confirmation, shop name, optional location. A confirmation email must be opened before the first sign-in. |
| Passwords | Change in Settings; admins issued temporary passwords | Forgotten-password links (single use, 30 minutes). Administrators can send a reset link but never see or set a password. |
| Profiles | None | Name, photo, phone, location, organisation, email with confirmation status, account details, active sessions. |
| Administrators | A separate `administrators` table | Ordinary accounts with the **Admin** or **Super Admin** role. The admin panel needs the password and an authenticator code. |
| Activity | Inside each shop's document | A server-wide `activity_events` table covering accounts, sign-ins and shop actions, with search and filters. |
| Audit | Admin actions, editable in principle | Before-and-after values, reasons and outcome, including refused attempts. The database rejects any change or deletion. |
| Admin panel | `/#/admin` | Also at **`/admin`**. Dashboard with date ranges, a server-side paged user table, a page per user, activity log, audit log and an editable **Settings** page. |

## Roles

| Role | Can |
| --- | --- |
| **User** | Use GreenBiz and manage their own account. Shop owners and bank users are both Users; *account type* (shop owner or bank) is separate from *role*. |
| **Admin** | Open the admin panel. See the dashboard, users, every shop's records and the activity log. Edit, suspend, reactivate (from suspended), deactivate and sign out **regular users**; send them confirmation and reset emails; invite bank users. |
| **Super Admin** | Everything an Admin can do, plus: change roles, act on Admin and Super Admin accounts, reactivate deactivated accounts, reset someone's two-step verification, delete accounts, read the audit log, and change server settings. |

The server checks the role on every admin request; hiding a button is never the protection. Rules that always hold:

- Public sign-up always creates a User. Any `role`/`accessRole` field in a sign-up or profile request is rejected.
- Nobody can change their own role or status from the admin panel.
- The last active Super Admin cannot be demoted, suspended, deactivated or deleted, and cannot delete their own account.
- Removing someone's administrator role ends their admin panel sessions at once. Suspending or deactivating an account ends **every** session, app and admin panel.
- Suspension, reactivation, deactivation, role changes, two-step resets and deletion require a reason, which is stored in the audit log.

## Setting up email

Email is needed for sign-up confirmation, password resets, email changes and bank invitations. Any SMTP provider works (Brevo, Mailgun, Amazon SES, Postmark, Gmail with an app password).

**From the admin panel (recommended).** Sign in as a Super Admin → **Settings** → *Email delivery*. Enter the SMTP server, port (587 for STARTTLS or 465 for TLS), username, password and sender, give a reason, and save. Use **Send me a test email** to check it. Saved settings take effect immediately and override the environment. The password is stored only in the server database, is never sent back to the browser, and appears in the audit log only as `set`.

**From the environment.** Set these for the API process:

| Variable | Example | Meaning |
| --- | --- | --- |
| `SMTP_HOST` | `smtp-relay.brevo.com` | Turns on SMTP delivery |
| `SMTP_PORT` | `587` | 465 means TLS from the start; anything else must upgrade with STARTTLS |
| `SMTP_SECURE` | `false` | Override the TLS choice above |
| `SMTP_USER`, `SMTP_PASSWORD` | | SMTP credentials |
| `MAIL_FROM` | `GreenBiz <no-reply@example.com>` | Required with SMTP |
| `MAIL_TRANSPORT` | `smtp`, `outbox` or `none` | `outbox` writes each email as JSON to `MAIL_OUTBOX_DIR` (development and tests only; refused in production) |

Without email, the server says so honestly: sign-up is refused while confirmation is required, and "Forgot password?" explains that no email was sent.

## Other settings

| Setting | Environment | Admin panel | Default |
| --- | --- | --- | --- |
| Require email confirmation for new accounts | `REQUIRE_EMAIL_VERIFICATION` | Settings | `true` |
| Days to keep activity events | `ACTIVITY_RETENTION_DAYS` | Settings | `365` (30–3650) |
| Trust the reverse proxy's client address | `TRUST_PROXY` (`true`, a hop count such as `1`, or proxy addresses) | — | `false` |
| Sign-in/sign-up requests per address per 15 minutes | `AUTH_RATE_LIMIT_MAX` | — | `10` |
| All API requests per address per 15 minutes | `RATE_LIMIT_MAX` | — | `300` |

Set `TRUST_PROXY=1` whenever the API sits behind Caddy, nginx or Cloudflare. Without it every visitor appears to come from the proxy, so the per-address rate limit is shared by everyone and session lists show the proxy's network.

## Creating the first Super Admin

Run this on the server. It needs shell access, which is what makes it safe, and it refuses to run if an active Super Admin already exists. Pass the password through the environment so it never appears in the process list or shell history.

```sh
# Docker (deploy/vps)
docker compose exec -T -e GREENBIZ_ADMIN_EMAIL=you@example.com -e GREENBIZ_ADMIN_PASSWORD='…' -e GREENBIZ_ADMIN_NAME='Your Name' \
  api node server/admin.js create-super-admin </dev/null

# Node directly
GREENBIZ_ADMIN_EMAIL=you@example.com GREENBIZ_ADMIN_PASSWORD='…' DATABASE_PATH=/var/lib/greenbiz/greenbiz.sqlite \
  node server-dist/admin.js create-super-admin
```

Then open `https://<your-server>/admin`, sign in, scan the QR code with an authenticator app, enter the code, and **store the ten recovery codes**. Add more administrators from the panel: open a user → *Change role*.

Recovery commands (all need shell access and are written to the audit log as "server command line"):

| Command | Use it when |
| --- | --- |
| `admin promote-super-admin` (env `GREENBIZ_ADMIN_EMAIL`) | No active Super Admin is left, or an upgrade review item says an administrator could not be converted. Add `--force` to promote while another Super Admin exists. |
| `admin reset-mfa` (env `GREENBIZ_ADMIN_EMAIL`) | An administrator lost their phone and recovery codes. They set up a new authenticator at the next admin sign-in. |
| `admin create-super-admin --additional` | Create another Super Admin from the server even though one exists. |

### Demo servers only: `--demo`

`create-super-admin --demo` creates a Super Admin that signs in to the panel with **a password only** (8 characters minimum, no authenticator), for a shared public demo. The panel shows a red warning on every page while such an account exists, and Settings lists it. A Super Admin can remove the exemption at any time (open the account → *Require two-step*); it can only be granted again from the server. Never use `--demo` on a server with real shop owners: anyone who knows that password controls every account.

## How activity is counted

- **Activity events** record registration, email confirmation, sign-in and sign-out (including failed attempts on existing accounts), password changes and resets, profile and photo changes, email changes, session sign-outs, account status and role changes, and every shop action: products added, updated or deleted, sales, imported and classified payment records, payment claims and reviews, shop details and bank-sharing changes, shop creation, deletion and export, invoice links, and bank offers, interests and document requests.
- Each event has an ID, the account it concerns, who did it, the action, the outcome, a short description, the related record ID, and for security events the device type ("Chrome on Android") and network (`203.0.113.x`, IPv6 to /48). Passwords, tokens, links and request bodies are never logged.
- **Last sign-in** is the last successful password sign-in. **Last activity** is the last signed-in request.
- **Daily active users**: accounts with at least one signed-in request that Dhaka day (opening the app, syncing, saving a record or using the admin panel). **Monthly active users**: distinct accounts active in the 30 days ending on the selected day.
- Recording starts when the server is upgraded to 2.4. Earlier days appear as hollow bars marked *not recorded*; nothing is estimated. Registration dates exist for every account, so sign-up charts cover all history.
- Activity events are removed after the retention period. The audit trail is kept indefinitely.
- All times are stored in UTC and shown in Dhaka time (GMT+6), which is labelled on every admin page.

## Upgrading from 2.3

Migration 6 runs automatically on start and only adds tables and columns; take a backup first anyway (see deploy/vps/README.md).

- Every existing administrator becomes a **Super Admin account** with the same email and password, and sets up two-step verification at the next admin sign-in. Administrator sessions end, so everyone signs in again.
- If an administrator's email already belongs to a customer account, it is **not merged** (whoever set that customer password may not be the administrator). It is listed under Settings → *Upgrade review*; grant access with `promote-super-admin` after checking who owns the address.
- Existing customer accounts keep signing in without confirming their email (they are shown as *Not confirmed* and can confirm from their profile). Suspended accounts stay suspended.
- Each shop owner's name is copied from the owner field of their first shop. Phone and location are left blank rather than guessed from shop details.
- Shop names are copied into the `shops` table for fast search. All shops, invoices, offers and interests stay linked to the same accounts.
- The old `administrators` table is kept, renamed `legacy_administrators`, and no longer used.
- Older Android apps (2.3 and earlier) can still sign in. Signing up from an old app fails while email confirmation is on, because the app expects a session straight away; update to 2.4.

## API summary

All admin routes need the admin panel cookie (`greenbiz_admin`, `HttpOnly`, `SameSite=Strict`, path `/api/admin`, at most 12 hours) except `login`, `login/mfa` and `me`. Mutations need the site's `Origin`. Field problems come back as `{ error, code: "invalid_input", fields: { name: message } }`; other refusals carry a stable `code` such as `email_unverified`, `locked`, `link_expired`, `not_admin`, `forbidden` or `last_super_admin`.

**Account (signed-in user)**

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | `202 {verificationRequired, email}` (same answer whether or not the address is registered), or a session when confirmation is off |
| POST | `/api/auth/login` | Session; `403 email_unverified`, `403 account_suspended`, `429 locked` |
| POST | `/api/auth/verify-email` · `/verify-email/resend` · `/verify-email/send` | Confirm with a link token; resend by address (always `202`); send to yourself |
| POST | `/api/auth/forgot-password` · `/reset-password/check` · `/reset-password` | Request (always `202`), check a link, set a new password |
| GET / POST | `/api/auth/profile` | Read or update name, phone, location, organisation |
| POST / DELETE | `/api/auth/avatar` | Upload (JPEG/PNG/WebP data URL, ≤400 KB) or remove the photo |
| POST / DELETE | `/api/auth/email` · POST `/api/auth/email/confirm` | Start, cancel or confirm an email change |
| GET | `/api/auth/sessions` | Active app and admin panel sessions |
| DELETE | `/api/auth/sessions/:id` · POST `/api/auth/sessions/revoke-others` | End one other session, or all others |
| POST | `/api/auth/password` | Change password (`current`, `password`, `confirmPassword`) |

**Admin panel**

| Method | Path | Needs |
| --- | --- | --- |
| POST | `/api/admin/login` → `/api/admin/login/mfa` | Password, then an authenticator or recovery code (or enrolment on first use) |
| GET | `/api/admin/overview?from&to` | Admin |
| GET | `/api/admin/users?q&role&type&status&verified&from&to&sort&dir&page&pageSize` | Admin |
| GET | `/api/admin/users/:id` (audited as `user.view`) · `/avatar` | Admin |
| POST | `/api/admin/users/:id/profile` · `/verification-email` · `/password-reset-email` · `/status` · `/sign-out` | Admin (regular users) / Super Admin (administrators) |
| POST | `/api/admin/users/:id/role` · `/reset-mfa` · `/mfa-exemption`; DELETE `/api/admin/users/:id` | Super Admin |
| POST | `/api/admin/banks` | Admin; emails an invitation link |
| GET | `/api/admin/shops`, `/shops/:id`, `/shops/:id/export` | Admin; views and exports are audited |
| GET | `/api/admin/activity?q&user&action&outcome&from&to&page` | Admin |
| GET | `/api/admin/audit?q&admin&action&outcome&from&to&page` | Super Admin |
| GET / POST | `/api/admin/settings`, `/settings/email` (POST, DELETE), `/settings/email/test` | Super Admin |
| GET | `/api/admin/system`; POST `/api/admin/review/:id/resolve` | Super Admin |

## Known limitations

- Authenticator secrets and a dashboard-saved SMTP password are stored unencrypted in the server database. Protect the database file and its backups like a password vault.
- Request rate limits are kept in memory per server process and reset on restart. Sign-in lockouts are stored in the database: five wrong passwords for one email from one network address lock that pair for 15 minutes (so a stranger cannot lock the owner out elsewhere), and 50 across all addresses lock the email for 15 minutes. A correct password or a completed reset clears them.
- A Super Admin can point email delivery at any SMTP host and port the server can reach. Only trusted people should hold that role.
- Two-step verification protects the admin panel. A shop owner's own app sign-in (including an administrator's) is password only.
- Shop actions are recorded when they succeed; a rejected shop action (for example, not enough stock) is not logged as a failure event. Security events (sign-ins, admin refusals) record failures.
- The overview's shop and sales totals read every shop's records on each request, which is fine for hundreds of shops but should become a summary table at a larger scale.
