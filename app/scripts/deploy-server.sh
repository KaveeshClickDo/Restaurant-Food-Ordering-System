#!/usr/bin/env bash
#
# One-command server deploy for Direct Dine — including the one-time
# marketing/broadcast setup (DB migration, contact backfill, CRON_SECRET,
# crontab entry, health check).
#
#   Usage (on the server, as root):
#     bash scripts/deploy-server.sh                 # full deploy
#     bash scripts/deploy-server.sh --no-backfill   # skip the contacts backfill
#
#   Overridable via env vars (defaults match the current server):
#     SERVICE_NAME=demo-directdine-tech.service
#     PORT=8086
#     CRON_SCHEDULE="*/5 * * * *"
#
# Idempotent — safe to run on EVERY deploy. One-time steps (secret generation,
# crontab entry) detect themselves and skip/refresh instead of duplicating.
# Note: the first time, `git pull` manually once so this script exists locally.

set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-demo-directdine-tech.service}"
PORT="${PORT:-8086}"
CRON_SCHEDULE="${CRON_SCHEDULE:-*/5 * * * *}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$APP_DIR/.env.local"

RUN_BACKFILL=1
for arg in "$@"; do
  case "$arg" in
    --no-backfill) RUN_BACKFILL=0 ;;
    *) echo "Unknown flag: $arg (supported: --no-backfill)"; exit 1 ;;
  esac
done

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$1"; }
ok()   { printf "\033[1;32m✓ %s\033[0m\n" "$1"; }
warn() { printf "\033[1;33m! %s\033[0m\n" "$1"; }

cd "$APP_DIR"

if [ ! -f "$ENV_FILE" ]; then
  warn ".env.local not found at $ENV_FILE — create it first (see example.env)."
  exit 1
fi

# ── Early sanity: NEXT_PUBLIC_SITE_URL is baked into the build ────────────────
SITE_URL="$(grep '^NEXT_PUBLIC_SITE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
if [[ -z "$SITE_URL" || "$SITE_URL" == *"localhost"* ]]; then
  warn "NEXT_PUBLIC_SITE_URL is '${SITE_URL:-<unset>}'. Unsubscribe links and open"
  warn "tracking in emails will NOT work until it's your real https domain."
  warn "Fix it in .env.local before this build if possible (Ctrl-C to abort)…"
  sleep 5
else
  ok "NEXT_PUBLIC_SITE_URL = $SITE_URL"
fi

step "Pulling latest code"
git pull --ff-only

step "Installing dependencies (no-op when unchanged)"
npm install --no-audit --no-fund

step "Building"
npm run build

step "Applying database migrations (idempotent)"
if grep -q '^DATABASE_URL=..*' "$ENV_FILE"; then
  npm run db:migrate
else
  warn "DATABASE_URL not set in .env.local — skipped db:migrate."
  warn "Either add it and re-run, or paste supabase/schema.sql into the Supabase SQL editor."
fi

if [ "$RUN_BACKFILL" -eq 1 ]; then
  step "Backfilling marketing contacts (idempotent — re-runs are no-ops)"
  if grep -q '^DATABASE_URL=..*' "$ENV_FILE"; then
    npm run db:backfill-contacts
  else
    warn "DATABASE_URL not set — skipped backfill."
  fi
fi

step "Ensuring CRON_SECRET exists in .env.local"
if grep -q '^CRON_SECRET=..*' "$ENV_FILE"; then
  ok "CRON_SECRET already set — keeping it"
else
  SECRET="$(openssl rand -hex 32)"
  printf '\n# Marketing broadcast scheduler (added by deploy-server.sh)\nCRON_SECRET=%s\n' "$SECRET" >> "$ENV_FILE"
  ok "Generated and saved a new CRON_SECRET"
fi
CRON_SECRET_VALUE="$(grep '^CRON_SECRET=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"

step "Restarting $SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
ok "Service restarted"

step "Installing crontab entry for scheduled broadcasts (one-time, self-refreshing)"
CRON_CMD="curl -fsS \"http://127.0.0.1:${PORT}/api/cron/dispatch-campaigns?secret=${CRON_SECRET_VALUE}\" >/dev/null 2>&1"
if crontab -l 2>/dev/null | grep -q "dispatch-campaigns"; then
  # Refresh the existing line so a rotated secret / changed port propagates.
  ( crontab -l 2>/dev/null | grep -v "dispatch-campaigns" || true; echo "$CRON_SCHEDULE $CRON_CMD" ) | crontab -
  ok "Cron entry refreshed ($CRON_SCHEDULE)"
else
  ( crontab -l 2>/dev/null || true; echo "$CRON_SCHEDULE $CRON_CMD" ) | crontab -
  ok "Cron entry installed ($CRON_SCHEDULE)"
fi

step "Verifying the dispatcher"
RESP=""
for _ in $(seq 1 15); do
  RESP="$(curl -s --max-time 10 "http://127.0.0.1:${PORT}/api/cron/dispatch-campaigns?secret=${CRON_SECRET_VALUE}" || true)"
  [[ "$RESP" == *'"ok":true'* ]] && break
  sleep 2
done
if [[ "$RESP" == *'"ok":true'* ]]; then
  ok "Dispatcher healthy: $RESP"
else
  warn "Unexpected response: ${RESP:-<none>}"
  warn "Check logs: journalctl -u $SERVICE_NAME -n 50 --no-pager"
  exit 1
fi

printf "\n\033[1;32m✓ Deploy complete.\033[0m Scheduled broadcasts fire within ~5 minutes of their time.\n"
