# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through GitHub's [private vulnerability reporting](https://github.com/durjoy-bd/Greenbiz/security/advisories/new). Include:

- what is affected (Android app, website, API server, admin console or the managed AI service);
- steps to reproduce, and the version (Settings shows it; the admin console shows the server's);
- the impact you expect.

You should get an acknowledgement within 3 working days. We'll agree a fix and disclosure timeline with you, and credit you unless you prefer otherwise.

## Supported versions

Only the latest release receives security fixes.

## Areas we care about most

- Access to another shop's records, or bypassing an administrator's or shop owner's sign-in.
- Admin console actions without an administrator session, or without an audit entry.
- Raw SMS text or personal records leaving the phone, or reaching an AI provider.
- Secrets (API keys, signing keys, passwords) in the repository, the APK or logs.

## Operating a server

- Serve GreenBiz over **HTTPS** before inviting real shop owners. `ALLOW_INSECURE_HTTP` exists only for IP-based testing.
- Create the first administrator on the server (`node server/admin.js create-admin`), then change its password in the admin console.
- Keep `AUTH_RATE_LIMIT_MAX` at its default (10) in production.
- Copy backups off the server; see `App-Website/deploy/vps/README.md`.
