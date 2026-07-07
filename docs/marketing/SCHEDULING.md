# Scheduled broadcasts — enabling the cron trigger

> **Shortcut:** `bash scripts/deploy-server.sh` (run in the app directory on
> the server) does everything on this page automatically — plus pull, build,
> migrate, backfill, and restart. The rest of this doc explains the manual
> steps it performs.

Scheduled broadcasts need something to hit the dispatch endpoint periodically.
This app is **not on Vercel** — it runs as a systemd service on a Debian server
(`demo-directdine-tech.service`, `next start` on port 8086) — so the trigger is
a server-side cron, not a platform cron.

Everything else (the compose UI, "Schedule" button, the resumable batch sender,
open tracking) already works. This is the one piece of infra to wire up once.

## 1. Set a secret

Add to the app's environment (the same place `RESEND_API_KEY` etc. live), then
restart the service:

```
CRON_SECRET=<a long random string>
```

```bash
systemctl restart demo-directdine-tech.service
```

The endpoint refuses to run (503) until `CRON_SECRET` is set, so it can never be
triggered anonymously.

## 2a. Option A — server crontab (simplest)

As root on the server:

```bash
crontab -e
```

Add one line (runs every 5 minutes, hits the local port directly):

```
*/5 * * * * curl -fsS "http://127.0.0.1:8086/api/cron/dispatch-campaigns?secret=YOUR_CRON_SECRET" >/dev/null 2>&1
```

That's it. Scheduled broadcasts now fire within ~5 minutes of their time, and
in-progress sends advance one batch per tick until drained.

## 2b. Option B — systemd timer (equivalent, more observable)

`/etc/systemd/system/directdine-campaigns.service`:

```ini
[Unit]
Description=Dispatch scheduled marketing broadcasts

[Service]
Type=oneshot
ExecStart=/usr/bin/curl -fsS "http://127.0.0.1:8086/api/cron/dispatch-campaigns?secret=YOUR_CRON_SECRET"
```

`/etc/systemd/system/directdine-campaigns.timer`:

```ini
[Unit]
Description=Run broadcast dispatcher every 5 minutes

[Timer]
OnCalendar=*:0/5
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl daemon-reload
systemctl enable --now directdine-campaigns.timer
```

## 2c. Option C — Supabase pg_cron + pg_net (no server cron)

If you'd rather drive it from the database (like a true scheduled job), enable
the `pg_cron` and `pg_net` extensions in Supabase and schedule an HTTP call:

```sql
select cron.schedule(
  'dispatch-campaigns',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://YOUR_SITE/api/cron/dispatch-campaigns',
       headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET')
     ); $$
);
```

Note: this is a real scheduled job — unlike loyalty-points expiry, which is
*not* a cron. Loyalty expiry is computed "on touch" inside the
`apply_loyalty_points` RPC whenever a customer's points are read or changed, so
there was no existing scheduler to reuse for broadcasts.

## Without any cron

Send-now works with **zero** setup — it drains the queue from the browser while
the compose screen is open. Only *scheduled* sends need the cron above. If you
never schedule, you can skip this entirely.
