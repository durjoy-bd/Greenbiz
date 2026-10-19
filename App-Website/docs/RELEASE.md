# GreenBiz release checklist

## Artifacts

Internal APK: debug-signed, suitable for user evaluation. Release AAB: built but unsigned without owner-provided signing configuration. Android identifier: `com.greenbiz.app`; display name `GreenBiz`; version `2.0.0`, version code `2`; min API 23, target API 36. Keep this identifier/signing identity stable when releasing updates to preserve on-device data.

The web app and backend have production build outputs. A successful local build does not establish production hosting, store approval, lender relationships or external-service delivery.

## Before a real release

- [ ] If offering the optional bank/cloud portal, operate an HTTPS server/domain and confirm API health and native CORS. Ordinary device shops and managed AI need no user server setup.
- [ ] Verify auth/register/login/logout/session expiry and recovery policy with the deployed server. Configure and test real email delivery before advertising password recovery.
- [ ] Restrict and back up the SQLite data volume. Test restoration on an isolated instance. Do not share a SQLite file across server replicas.
- [ ] Provision only verified bank operators. Confirm sharing off immediately removes records and interest history from bank views.
- [ ] Contract an approved bKash integration and implement/test authoritative verification before enabling any automatic-verification claim. Personal SMS or a customer-entered TrxID is not payment proof.
- [ ] Maintain the hosted managed AI secret, provider spending controls and daily limits; review provider data terms. Recheck stock, sale and advice after model/provider changes.
- [ ] Confirm SMS permission eligibility and declarations before Play submission; inbox access is opt-in and may require store approval.
- [ ] Test on physical Android devices: cold start, offline records, keyboard/insets, back button, camera/photo picker, secure token persistence, native share/export, low-storage handling, and system font scaling.
- [ ] Review Android and npm dependencies for ongoing support; pinned Capacitor 6 was selected for the installed Java 17 environment. The local build targets API 36, but this does not replace device/OS compatibility testing.
- [ ] Supply the owner’s keystore via `GREENBIZ_KEYSTORE`, `GREENBIZ_STORE_PASSWORD`, `GREENBIZ_KEY_ALIAS`, `GREENBIZ_KEY_PASSWORD` in a secure build environment. No release key is generated, committed, or invented here.
- [ ] Run `npm ci`, lint, typecheck, domain/API/browser tests, web/server builds, dependency audit and Android release build on the final source revision.
- [ ] Verify the signed AAB certificate and package metadata; upload through the owner’s Play account; complete privacy/data safety, content, testing, screenshots and listing requirements.
- [ ] Test migration/update without losing device or server data. Obtain store approval before claiming publication.

## Deployment templates

`Dockerfile`, `deploy/compose.yml` and `deploy/Caddyfile` prepare a private API volume and same-origin HTTPS static frontend. Docker was not available for executing a deployment test here. Run `npm run build` before starting compose because Caddy mounts the built `dist` directory. Set a real `GREENBIZ_DOMAIN`, configure DNS, and review service/volume permissions, firewall, monitoring and off-site backups. Never publish `.env`, signing keys, database files or private invoice links.

## Support and recovery

Device records are removed by uninstall/clear-data; regular explicit exports are required. Preserve JSON/CSV exports in a secure location. The app currently offers export but no automatic device backup import/merge. Server database backup/restore commands and schema migration policy are in `SERVER.md`. For expired sessions sign in again; the absolute session lifetime is seven days. If the server is unreachable, local sign-out clears device access but cannot confirm remote revocation.
