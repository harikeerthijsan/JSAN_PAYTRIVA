# PAYTRIVA — Production Deployment Guide

PAYTRIVA is a Next.js (App Router) application backed by PostgreSQL with a separate
background worker for notifications and scheduled reminders. This guide covers a standard
single-region deployment behind an HTTPS reverse proxy.

> Do not deploy to production without authorization, and do not run with development
> credentials or demo data (`PTR-DEMO-*`).

## 1. Prerequisites

- Node.js 20.9+ (the app is tested on Node 20–24).
- PostgreSQL 16+ (a managed instance is recommended).
- An HTTPS termination point (reverse proxy, load balancer, or platform ingress).
- An SMTP provider for email delivery (activation is no longer used; email is for
  password resets and notifications).
- A persistent, **private** volume or object store for uploaded invoices/payment proofs.

## 2. Environment configuration

Copy `.env.example` to `.env` (or set real environment variables) and provide:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. Use a dedicated least-privilege DB user. |
| `APP_URL` | Public HTTPS base URL (e.g. `https://paytriva.jsan.example`). Must be HTTPS in production. |
| `NODE_ENV` | Set to `production`. |
| `SESSION_DURATION_DAYS` | Session lifetime (default 7). |
| `PASSWORD_RESET_EXPIRY_MINUTES` | Reset-link validity (default 30). |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | Email delivery. Required in production for reset/notification email. |
| `NOTIFICATION_SECRETS_KEY` | Encryption key for SMTP passwords stored via the admin Notification settings UI. Set once and never rotate without re-entering the stored SMTP password. |
| `ALLOWED_EMAIL_DOMAIN` | Optional domain restriction for employee emails. |
| `PAYTRIVA_UPLOAD_DIR` | Absolute path to the private document store (outside the web root). |
| `PAYMENT_MAX_FILE_BYTES` / `PAYMENT_MAX_TOTAL_UPLOAD_BYTES` | Upload size limits. |
| `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` / `INITIAL_ADMIN_NAME` | Bootstrap administrator created by the seed. The password must meet policy (12+ chars, upper/lower/number/symbol, ≤72 bytes). |

Secrets must come from the platform secret store or environment — never commit `.env`.

## 3. Build and database preparation

```bash
npm ci
npm run db:generate          # generate the Prisma client
npm run db:migrate           # apply committed migrations (prisma migrate deploy)
npm run db:seed              # idempotent: roles, permissions, USD currency, bootstrap admin
npm run build                # production build
```

Run `npm run db:migrate` on every release before starting the new app version. Migrations
are ordered and validated; a fresh database applies them cleanly end to end.

## 4. Run the application and worker

PAYTRIVA needs **two** long-running processes:

```bash
# 1) Web application
npm run start                # next start (bind to a local port, e.g. 3000)

# 2) Background worker (scheduled reminders + email outbox)
npm run notifications:worker
```

- The worker polls every 30 seconds for due approval reminders (8/24/48h), due/overdue
  AP notifications, and retryable email. **Starting the web app alone does not run
  scheduled jobs.** Run the worker under a process supervisor (systemd, pm2, or a
  container) so it restarts automatically. Reminder and email state lives in the database,
  so the worker is safe to restart.
- Both processes must share the same `DATABASE_URL`, `NOTIFICATION_SECRETS_KEY`, and
  `PAYTRIVA_UPLOAD_DIR`.

## 5. Reverse proxy / HTTPS

Terminate TLS at the proxy and forward to the app. Required:

- Serve over HTTPS; set `APP_URL` to the HTTPS origin. The session cookie is `Secure`,
  `HttpOnly`, `SameSite=Lax` and only transmits over HTTPS in production.
- Forward the real client IP via `X-Forwarded-For` (used by the audit log).
- Security headers (CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`) are emitted by the app; do not strip them.

## 6. Health checks

- `GET /api/health` returns `200` with `{"status":"ok","checks":{"database":true}}` when
  the app and database are reachable, and `503` when the database is down. It requires no
  authentication and exposes no business data — use it for load-balancer and uptime probes.

## 7. Scaling notes

- **Uploads:** multiple app instances must share one private volume or object store for
  `PAYTRIVA_UPLOAD_DIR`; local disk is not shared across instances.
- **Worker:** run exactly one worker (or ensure idempotency) — reminder/email claims use
  database row updates, so a single worker is simplest and safe.
- **Database:** add read capacity and connection pooling (e.g. PgBouncer) as volume grows;
  all list/report endpoints paginate and cap result sets.

## 8. Release checklist

1. Back up the database and the private upload store (see `BACKUP_RECOVERY.md`).
2. Deploy new code; run `npm run db:migrate` then `npm run db:seed`.
3. Start/rolling-restart the web app and the worker.
4. Verify `GET /api/health` is `200` and a test login succeeds.
5. Confirm no demo data (`PTR-DEMO-*`) is present in production.
