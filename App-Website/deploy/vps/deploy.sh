#!/usr/bin/env bash
# Builds GreenBiz and ships it to a VPS over SSH. Re-run it for every update.
#   ./deploy/vps/deploy.sh vps            # SSH host alias or user@host
# The first run expects /opt/greenbiz/.env on the server (see .env.example).
set -euo pipefail
HOST="${1:?Usage: deploy.sh <ssh-host>}"
DIR="${GREENBIZ_DIR:-/opt/greenbiz}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$ROOT"
npm run package:vps

echo "Uploading to $HOST:$DIR …"
ssh "$HOST" "mkdir -p '$DIR'"
(cd deploy/vps && tar czf - compose.yml Caddyfile build) | ssh "$HOST" "cd '$DIR' && rm -rf build.new && mkdir build.new && tar xzf - -C build.new && rm -rf build && mv build.new/build build && mv build.new/compose.yml build.new/Caddyfile . && rmdir build.new && chown -R root:root . && chmod -R a+rX build"

ssh "$HOST" "cd '$DIR' && test -f .env || { echo 'Missing $DIR/.env (copy deploy/vps/.env.example).'; exit 1; }"
# </dev/null keeps docker from reading the rest of the SSH session as input.
ssh "$HOST" "cd '$DIR' && docker compose pull -q </dev/null && docker compose up -d --force-recreate </dev/null && sleep 10 && docker compose ps --format '{{.Name}} {{.Status}}' && curl -fsS http://127.0.0.1:\$(grep -E '^GREENBIZ_PORT=' .env | cut -d= -f2 || echo 8790)/api/health"
echo
echo "Deployed."
