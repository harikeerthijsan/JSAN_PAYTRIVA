# PAYTRIVA — Audit & Production Readiness Report

_Status: **Conditional go** — all automated tests pass and critical/high findings are
resolved; go-live depends on the operational items in §9 (SMTP, HTTPS environment, backup
automation, and formal UAT sign-off). Do not deploy to production without authorization._

## 1. Scope

A full review of every module, the security posture, data-integrity and financial
calculations, performance, error handling, and the automated test suite. This report lists
findings by severity with their resolution, and a go-live checklist.

## 2. Module audit

| Module | Status | Notes |
|---|---|---|
| Authentication & user management | ✅ | Direct employee creation (admin-set password, active immediately); roles + per-user permissions; secure sessions; login rate-limiting. |
| Payment request management | ✅ | Draft/submit, validated uploads, server-side field validation. |
| Invoice uploads | ✅ | Extension + MIME + file-signature checks; private storage outside web root; authenticated download. |
| Duplicate invoice detection | ✅ | Normalized vendor+invoice+amount fingerprint with a unique DB constraint. |
| Currency conversion | ✅ | USD reporting currency; rate/source/date stored on each transaction. |
| Approval workflow | ✅ | AP review, amount-band auto-routing, approve/reject/clarify/return; append-only history. |
| AP management & payment processing | ✅ | Queue, one-time confirmation with proof, corrections with before/after snapshots. |
| Notifications & reminders | ✅ | In-app + email, 8/24/48h reminders, outbox with retry/backoff, background worker. |
| Payment calendar | ✅ | Wednesday engine + 7-day minimum, month/week/day views, role-scoped. |
| Financial tracking | ✅ | Overdue/at-risk/due-this-week, currency/project/vendor summaries. |
| Management dashboard & reports | ✅ | KPIs, charts, aging/project/vendor/upcoming/overdue/history, CSV/XLSX/PDF export; `reports:access` gated. |
| Audit logging | ✅ | Centralized, append-only; admin-only read; covers auth, user admin, and payment events. |

## 3. Findings and resolutions

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | **Critical** | Migration ordering: `payment_calendar_scheduling` was named before the migrations that create `ApprovalThreshold`/`PaymentSchedule`, so a **fresh deploy would fail**. | Renamed to sort after its dependencies and synced the applied-migrations table; shadow-replay now validates clean. |
| 2 | **High** | No centralized audit trail for security/admin/payment events. | Added `AuditLog` (append-only), a service, wiring across auth/user-admin/payment routes, and an admin-only viewer. |
| 3 | **High** | No HTTP security headers. | Added CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. |
| 4 | **Medium** | No health/readiness probe. | Added `GET /api/health` (DB check, no auth, no business data). |
| 5 | **Medium** | Integration tests ran concurrently against a shared DB causing serialization flakiness. | Pinned `test:integration` to `--test-concurrency=1`. |

No open critical or high findings remain.

## 4. Security audit

- **Authentication:** bcrypt (cost 12) password hashing; opaque, hashed session tokens;
  timing-safe credential comparison; login rate-limiting with lockout.
- **Sessions:** cookies are `HttpOnly`, `Secure` (production), `SameSite=Lax`; expired/
  inactive sessions are rejected and cleared; password reset revokes existing sessions.
- **Authorization:** every API handler and page checks permissions server-side; hiding a nav
  link is never the boundary. Role scoping verified for Requestor/AP/Approver/Management.
- **Injection:** all database access is via Prisma's parameterized API; no raw string SQL.
- **XSS:** React escaping throughout; no `dangerouslySetInnerHTML`; email HTML is escaped.
- **CSRF:** state-changing requests require the `SameSite=Lax` session cookie, which is not
  sent on cross-site form posts.
- **File uploads:** type/MIME/signature validation, size limits, private storage, authenticated
  access with owner/AP checks; payment-account values masked unless explicitly permitted.
- **Secrets:** read from environment/secret store; SMTP passwords encrypted at rest with
  `NOTIFICATION_SECRETS_KEY`; secrets never returned by APIs or written to logs.

## 5. Data integrity & financial validation

- Unique transaction IDs, duplicate-invoice fingerprint, one-confirmation-per-request, and
  unique payment references are enforced by DB constraints.
- Total Paid uses **confirmed** amounts only; Outstanding excludes paid; overdue uses the
  **original invoice due date**; approval aging uses **assignment timestamps**.
- Currencies are converted to USD using the rate stored with each transaction; totals never
  mix currencies. Multi-currency and decimal math are covered by unit tests.
- Paid transactions cannot be paid again; the original due date is never modified; all
  history (request, schedule, correction, audit) is append-only and preserved.

## 6. Performance

- All list/report/calendar endpoints paginate and cap result sets; aggregates run in bounded
  queries. 40+ database indexes back the common filters (status, dates, project, vendor,
  approver, schedule, audit). Dashboard figures are computed from live records with caps and
  a `capped` flag surfaced to the UI. Background jobs are claimed via row updates to avoid
  duplicate work.

## 7. Error handling & reliability

- User-facing messages are friendly; server errors are caught and logged without leaking
  internals. Payment state changes run in serializable transactions; upload failures clean up
  partial files; email failures retry with exponential backoff and are recorded; audit writes
  are best-effort for auth and transactional for payment events so they never corrupt records.

## 8. Test results

- **Unit:** 40 passing (scheduling engine, report calculations, validation, security,
  payment math, file/proof validation).
- **Integration (PostgreSQL + running app, serial):** 24 passing — auth/roles/permissions,
  payment lifecycle, approval reminders, notifications, calendar/scheduling, management
  reports + exports, audit logging, and health/security headers.
- **Static:** `tsc --noEmit` and `eslint` clean.

## 9. Go-live checklist (operational — required before production)

- [ ] Configure production **SMTP** and verify a test email from Notification settings.
- [ ] Serve over **HTTPS** with `APP_URL` set to the HTTPS origin; confirm security headers
      pass through the proxy and the real client IP is forwarded.
- [ ] Provision **persistent private storage** for `PAYTRIVA_UPLOAD_DIR` (shared if multi-instance).
- [ ] Run the **notification worker** under a supervisor.
- [ ] Set `NOTIFICATION_SECRETS_KEY` and all secrets from the secret store; `NODE_ENV=production`.
- [ ] Enable **automated backups** for the database and document store (see `BACKUP_RECOVERY.md`)
      and complete one **restore drill**.
- [ ] Apply migrations (`db:migrate`), seed (`db:seed`), confirm `/api/health` is `200`.
- [ ] Remove all demo data (`PTR-DEMO-*`) and demo logins.
- [ ] Complete **User Acceptance Testing** sign-off for Requestor, AP, Approver, and
      Management scenarios.

## 10. Known limitations

- PAYTRIVA records externally-executed payments; it does **not** initiate bank transfers or
  integrate with a bank.
- Email requires SMTP; with SMTP unconfigured, notifications queue but are not delivered.
- The CSP permits inline/eval scripts to support Next.js hydration; it can be tightened with
  per-request nonces behind a reverse proxy.
- The Microsoft 365 / external identity-provider integration is isolated behind the auth
  layer but not enabled.
- Reports and dashboards cap very large result sets (surfaced via a `capped` indicator);
  extremely large datasets would benefit from pre-aggregation.
