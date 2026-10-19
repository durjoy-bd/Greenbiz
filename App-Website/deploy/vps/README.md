# Running GreenBiz on your VPS

GreenBiz runs as two small containers that sit beside your other sites without touching them:

| Container | What it does | Memory cap |
| --- | --- | --- |
| `greenbiz-web-1` | Caddy serves the static website and passes `/api/*` to the API | 128 MB |
| `greenbiz-api-1` | Node 24 runs the self-contained GreenBiz server (no `npm install` on the VPS) | 256 MB |

Everything lives in `/opt/greenbiz`, and the SQLite database is in the Docker volume `greenbiz_greenbiz_data`. The stack publishes a single port (`GREENBIZ_PORT`, default 8790).

## Addresses

- Website and shop-owner sign-in: `http://<server>:8790/`
- Admin console: `http://<server>:8790/#/admin`
- Health check: `http://<server>:8790/api/health`

## First deployment

1. On the server: `mkdir -p /opt/greenbiz`, copy `.env.example` to `/opt/greenbiz/.env`, set `PUBLIC_ORIGIN` to the exact address people will use, then run `chmod 600 .env`.
2. From your computer: `./deploy/vps/deploy.sh <ssh-host>`.
3. The API runs as the unprivileged `node` user, so give it the data volume once:
   `docker compose run --rm --no-deps --user root --entrypoint sh api -c 'chown -R node:node /data' </dev/null`
4. Open the port: `ufw allow 8790/tcp`.
5. Create the first administrator:
   `docker compose exec -T -e GREENBIZ_ADMIN_EMAIL=you@example.com -e GREENBIZ_ADMIN_PASSWORD='…' api node server/admin.js create-admin </dev/null`
   Add more administrators, bank users and password resets from the admin console afterwards.

## Updating

Run `./deploy/vps/deploy.sh <ssh-host>` from the project folder. It builds, uploads, recreates both containers and checks health. Data in the volume is kept, and database migrations run automatically on start.

## Everyday operations (in `/opt/greenbiz`)

| Task | Command |
| --- | --- |
| Status | `docker compose ps` |
| Logs | `docker compose logs --tail 100 api` |
| Restart | `docker compose restart` |
| Backup now | `docker compose exec -T api node server/backup.js /data/backups/manual-$(date +%F-%H%M).sqlite </dev/null` |
| List backups | `docker compose exec -T api ls -lh /data/backups </dev/null` |
| Copy a backup off the server | `docker cp greenbiz-api-1:/data/backups/<file> .` then download it |
| Stop | `docker compose down` (keeps data). `docker compose down -v` deletes the database: never run it without a backup. |

`/etc/cron.d/greenbiz-backup` makes a verified backup every night at 02:30 and keeps 14 days. Backups stay inside the same volume, so copy important ones off the server too.

## Restoring a backup

```sh
docker compose stop api
docker run --rm -v greenbiz_greenbiz_data:/data alpine sh -c 'cp /data/greenbiz.sqlite /data/before-restore.sqlite && cp /data/backups/<file> /data/greenbiz.sqlite && rm -f /data/greenbiz.sqlite-wal /data/greenbiz.sqlite-shm && chown 1000:1000 /data/greenbiz.sqlite'
docker compose start api
```

## Switching on HTTPS (needed before real shop owners and the Android app)

The current setup is plain HTTP by IP, which is fine for testing but sends passwords unencrypted. The Android app refuses to sign in over HTTP.

Ports 80/443 on this VPS are already forwarded elsewhere, so pick one of these:

1. **Cloudflare tunnel (recommended here).** `cloudflared` is already running. Add an ingress rule such as `greenbiz.<your-domain>` → `http://localhost:8790` to `/etc/cloudflared/config.yml`, route that DNS name to the tunnel and restart `cloudflared`. Cloudflare provides the certificate.
2. **Domain straight to this server.** If 80/443 are freed, change the Caddyfile's `:80` to the domain name, publish `80:80` and `443:443`, and Caddy obtains a Let's Encrypt certificate automatically.

Then set `PUBLIC_ORIGIN=https://<domain>` and remove `ALLOW_INSECURE_HTTP` from `.env`, and run `docker compose up -d`. To make the Android app use that server by default, build it with `VITE_GREENBIZ_SERVER=https://<domain>`.

## Privacy

Administrators can see every shop's full records. Shop owners are told this when they create an account, and every administrator sign-in, record view, export and account change is written to the audit log (Admin → Audit log).
