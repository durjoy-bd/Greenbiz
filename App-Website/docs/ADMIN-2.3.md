# GreenBiz 2.3: accounts, admin console and VPS deployment

> **Superseded for accounts and administration by [ACCOUNTS-2.4.md](ACCOUNTS-2.4.md).** From 2.4, administrators are accounts with an Admin or Super Admin role, the panel needs two-step verification, and temporary passwords are replaced by emailed reset links. The static website notes below still apply.

## Who signs in where

| Person | Where | Account type |
| --- | --- | --- |
| Shop owner | Website welcome screen → **Sign in or create an account** (or the app, once the server has HTTPS) | Customer account (`users`, role `merchant`) |
| Bank user | Same sign-in; routed to the lending desk | Customer account (role `bank`), created by an administrator |
| Platform administrator | `/#/admin` | Separate `administrators` table, its own cookie and sessions |

Administrators are never customer accounts. Their session cookie is `httpOnly`, `SameSite=Strict` and scoped to `/api/admin`, so it is not sent with shop-owner requests, and an administrator cookie cannot open shop-owner routes.

## Admin console

| Section | What it shows or does |
| --- | --- |
| Overview | Shops, owners, sign-ins and suspensions; sales today, this month and all time across every shop; stock value; payment records; 30-day sales and sign-up charts; top shops this month |
| Shops | Searchable table with CSV export. Opening a shop shows its KPIs, credit profile, details, full stock, sales (latest 300), payment records, invoice claims and activity, plus a JSON export |
| Accounts | Every shop owner and bank user with joined, last sign-in and status. Actions: suspend/restore, sign out everywhere, reset password (a one-time temporary password shown once), delete (type the email to confirm). Create bank users and add administrators |
| Activity | The latest changes recorded by every shop |
| Audit log | Every administrator sign-in, shop view, export, password change and account action |
| System | Address, HTTP or HTTPS, version, runtime, uptime, memory and database size; change your administrator password |

Suspending an account signs it out everywhere immediately and blocks sign-in until it is restored. A password reset also signs the owner out everywhere; only the hash of the temporary password is stored.

## Shop-owner security added in 2.3

- **Change password** in Settings (server accounts). Other devices are signed out; this one stays signed in.
- Last sign-in time is recorded and shown to administrators.
- New sign-ups are told that the server's administrator can view their records and that every view is logged.

## Admin API

All routes need the administrator cookie except `login` and `me`. Mutations need the configured site `Origin`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/admin/login` | `{ email, password }`, rate-limited to 5 per 15 minutes |
| POST | `/api/admin/logout` | End this session |
| GET | `/api/admin/me` | `{ admin }`, or `{ admin: null }` when signed out |
| POST | `/api/admin/password` | `{ current, password }`; signs out other administrator sessions |
| GET | `/api/admin/overview` | Platform totals and 30-day series |
| GET | `/api/admin/shops?q=` | All shops with summaries |
| GET | `/api/admin/shops/:id` | Full workspace, dashboard, indicator, credit profile, invoices (audited) |
| GET | `/api/admin/shops/:id/export` | JSON export (audited) |
| GET | `/api/admin/users?q=` | Accounts with shops and status |
| POST | `/api/admin/users/:id/suspend` | `{ suspended: boolean }` |
| POST | `/api/admin/users/:id/sign-out` | Revoke every session |
| POST | `/api/admin/users/:id/reset-password` | Returns `{ temporaryPassword }` once |
| DELETE | `/api/admin/users/:id` | `{ email }` must match; cascades shops |
| POST | `/api/admin/banks` | Create a bank user |
| GET / POST | `/api/admin/administrators` | List or add administrators |
| GET | `/api/admin/activity` | Cross-shop activity feed |
| GET | `/api/admin/audit` | Latest 300 audit entries |
| GET | `/api/admin/system` | Server status |

The first administrator is created on the server with `node server/admin.js create-admin` (environment `GREENBIZ_ADMIN_EMAIL` / `GREENBIZ_ADMIN_PASSWORD`). There is deliberately no web sign-up for administrators.

## Server settings added in 2.3

| Variable | Default | Meaning |
| --- | --- | --- |
| `ALLOW_INSECURE_HTTP` | `false` | Lets production run over plain HTTP (IP-only testing). Cookies are Secure only on HTTPS. |
| `AUTH_RATE_LIMIT_MAX` | `10` | Sign-in/sign-up attempts per 15 minutes per address. Raise it only on test servers. |
| `GREENBIZ_VERSION` | `development` | Shown in Admin → System |
| `VITE_GREENBIZ_SERVER` (build time) | blank | Default server for static builds and the Android app |

## Static website

The build uses relative asset paths and hash routing, so `dist/` runs from any static host, sub-folder or file server with no rewrites. Without a server, shops are saved in the browser (device mode). Served by a GreenBiz server, the same files add accounts and the admin console. When served over plain HTTP, small fallbacks replace the browser crypto functions that only exist on HTTPS.

Deployment and operations are covered in [deploy/vps/README.md](../deploy/vps/README.md).
