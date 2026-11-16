# PAYTRIVA — JSAN Enterprise Financial Control Platform

PAYTRIVA is a Next.js application for JSAN Consulting's financial-control platform. It provides administrator-created employee accounts, database-backed sessions, role and permission enforcement, user administration, payment request management, AP-to-approver review workflow, audited manual payment confirmation, and a centralized audit log. It does not initiate payments or connect to a bank.

## Stack

- Next.js App Router, React, and TypeScript
- PostgreSQL with Prisma ORM and versioned SQL migrations
- bcrypt password hashing, opaque single-use account tokens, and database-backed sessions
- Zod request validation and server-side permission checks

## Local setup

1. Install Node.js 20.9 or later and PostgreSQL 16 or later.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, `APP_URL`, and a bootstrap administrator email, name, and password. The bootstrap password must be at least 12 characters, no more than 72 UTF-8 bytes, and include uppercase and lowercase letters, a number, and a symbol. Set `ALLOWED_EMAIL_DOMAIN` to the actual JSAN employee email domain when confirmed; no domain is assumed by the application.
3. Install dependencies and prepare the database:

   ```powershell
   npm install
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```

4. Start the app with `npm run dev`.

Private invoice uploads are stored under `.private-uploads` by default, outside `public`. Set `PAYTRIVA_UPLOAD_DIR` to an absolute path on a persistent private volume in production, and set the file-size limits as needed. Back up the private storage alongside the database; document metadata alone is not sufficient to recover uploaded files.

The seed creates the Requestor, Accounts Payable, and Approver roles and their baseline permissions. Requestors receive own-request permissions; Accounts Payable can read submitted requests; Approvers retain access only to requests assigned to them. It creates the initial administrator as an Accounts Payable user with separate `platform:admin` and `payments:manage_masters` permissions. The seed also creates the USD base currency. The approval migration installs four USD bands, initially without assigned users; an administrator must assign active Approver-role users in **Approval matrix**. It does not add example vendors, entities, projects, cost centers, exchange rates, or payment requests. Bootstrap credentials are read from the environment, never printed, and an existing account's password is not reset when seeding again.

### Employee creation and email

Administrators create employees directly in **User management → Create employee**: they set the name, work email, role, and an initial password (which must meet the password policy), and the account is active immediately and can sign in. Platform administrators may also grant additional permissions at creation or later via **Manage access**. Every creation and permission change is recorded in the audit log.

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and an HTTPS `APP_URL` to deliver password-reset links and notification email. SMTP is optional for local development: when unconfigured, a reset link is shown only in the development password-recovery response and notification email is queued rather than sent. These links are never written to logs. Password-reset links expire after `PASSWORD_RESET_EXPIRY_MINUTES` (30 by default), are single-use, and revoke existing sessions when used.

## Roles and authorization

Roles and permissions are persisted in the database. The standard roles receive only these baseline capabilities:

| Role | Baseline access |
|---|---|
| Requestor | Own profile and own payment requests |
| Accounts Payable | AP workspace, employee directory, employee creation, role assignment, account activation/deactivation, submitted payment requests |
| Approver | Assigned approval workspace |

Payment master data and exchange rates require the explicit `payments:manage_masters` permission. AP membership does not automatically grant platform administration or master-data administration. Requestors can only read and change their own drafts and requests. AP users can read submitted requests, but never drafts.

Administrators can also define and activate percentage or fixed-amount withholding-tax and other-deduction rules. These records remain configuration for future financial rules and do not alter request totals.

## Payment requests

Requestors create a draft, add a required invoice and optional attachments, then submit it for **Pending Review**. AP must start a review and explicitly forward the validated request before it can enter **Pending Approval**. The assigned approver can approve, reject, or request clarification. An approval moves the request to **Approved** for the AP payment queue. Clarification returns the request to its owner, who can update and resubmit it to AP. All status changes, comments, assignments, and clarification events are retained in an append-only history.

The default USD bands are below $5,000; $5,000–$39,999.99; $40,000–$49,999.99; and $50,000 or more. Routing uses the saved **Final value (USD)**. The $40,000–$49,999.99 band is explicitly marked as pending business confirmation and blocks forwarding until configured. No approver identity or email is hardcoded; a user with `payments:manage_masters` assigns active Approver-role users to each band in **Approval matrix**. Threshold assignments apply to future AP forwards; previously assigned approvals are preserved. In-app and queued email notifications are generated for request submission and resubmission, approval assignment, clarification, returns, approval decisions, and payment confirmation. Approval reminder schedules are persisted per assignment, use configurable hour intervals (default 8/24/48), and are canceled when the assignment is resolved or the request leaves pending approval.

## AP payment processing

The AP workspace provides review, management metrics, an approved-and-unpaid payment queue, calendar views, and project payment summaries. Queue filters include vendor, project, currency, approver, transaction ID, invoice/due dates, and search; queue results can be paginated, sorted, bulk scheduled, and exported as CSV. The calendar groups scheduled dates separately from the original invoice due date, and highlights due-this-week, overdue, Wednesday-scheduled, and completed items.

Payment schedules can only be changed for approved unpaid requests. AP records payments already made outside PAYTRIVA using the confirmation form; confirmation requires amount, currency, actual date, a unique payment reference, payment method/account, and valid PDF/JPG/PNG proof. Confirmation and status updates are written in one database transaction, and each request can only be confirmed once. Proof files are stored privately and served only to AP users or users with `payments:read_payment_proof`. Payment-account values are masked unless the viewer has `payments:read_payment_account`.

Only users with both `ap:access` and explicit `payments:correct` permission can correct a confirmed payment. A reason is mandatory, each correction stores before/after snapshots and actor/time, and a corresponding status-history entry is appended. The bootstrap administrator receives this permission; ordinary AP membership does not grant corrections or restricted account visibility. Manual confirmation records an external payment; PAYTRIVA does not initiate transfers or integrate with banks.

## Payment calendar and financial tracking

JSAN pays on a weekly cycle, every Wednesday, with a minimum seven calendar-day lead time measured from the payment request submission date. When a request is approved, the backend scheduling engine (`src/lib/payment-scheduling.ts`) computes the earliest eligible payment date (submission + 7 days) and the first eligible Wednesday on or after it, and stores both the scheduled payment date and the earliest eligible date on the payment schedule. All scheduling arithmetic is performed server-side in UTC on date-only values so results do not shift with server or viewer time zones; for example a request submitted on 04-Nov-2026 (Wednesday) is scheduled for 11-Nov-2026 (Wednesday). Frontend date math is never used for scheduling.

The original invoice due date is stored separately and never modified. If the earliest eligible Wednesday falls after the invoice due date, the request is flagged **at risk** (`PaymentRiskStatus.AT_RISK`) and AP is notified; ineligible payments are never silently scheduled. AP can manually reschedule an approved, unpaid request, but a date before the seven-day minimum is rejected and risk is re-evaluated against the due date. Every calculation and change is appended to an immutable `PaymentScheduleHistory` trail shown on the request detail.

The **Payment calendar** (`/workspace/calendar`) offers month, week, and day views with upcoming Wednesday cycles, and classifies each payment as upcoming, due this week, overdue, at risk, or completed. A pending-approval invoice is never treated as overdue. The **Upcoming payments** view groups approved payments by scheduled Wednesday with per-date totals, invoice counts, and currency- and project-wise breakdowns. **Financial tracking** reports upcoming, due-this-week, overdue, at-risk, paid, and outstanding-approved totals plus currency, project, and vendor breakdowns, all converted to the USD reporting currency using the rate stored with each transaction. Calendar and summary data are role-scoped on the backend: requestors see only their own requests, approvers see requests assigned to them, and `payments:read_all` holders (AP and management) see the consolidated view. Scheduling, reschedules, due-this-week, overdue, and at-risk events raise in-app and email notifications through the Phase 5 service with deduplicated event keys.

## Management dashboard and financial reports

The consolidated management dashboard (`/workspace/management`) is gated by the configurable `reports:access` permission — not by hardcoded names or email checks. Platform administrators grant it per user from the employee screen in **User management** (when creating an employee or via **Manage access**), and the bootstrap administrator receives it by default. Every figure is computed from live database records in the USD reporting currency; nothing is hardcoded or dummy data.

The dashboard presents eight KPI cards — Total Open AP, Due This Week, Overdue Invoices, Total Paid, Pending Approvals, Approved and Waiting, Total Outstanding, and Total Payment Requests — each with its value, invoice count, optional previous-period comparison, and click-through to the matching report. Interactive charts cover monthly payment trends (requests, approvals, completed payments by real timestamps), status distribution, currency distribution (original and USD), and project expenditure. Dedicated reports provide approval aging (0–8/8–24/24–48/48+ hour buckets from the actual approval-assignment timestamps, with delays highlighted), project-wise expenditure (requested, approved, paid, outstanding, overdue, with cost centre), vendor-wise payments (invoices, value, paid, pending, overdue, last payment date), and upcoming and overdue payment reports. Global filters — date range, financial year (1 April–31 March), project, cost centre, vendor, payment status, currency, approver, and JSAN entity — apply to every card, chart, and report, and a previous equal-length period is compared when an explicit range is set.

Calculation rules are enforced centrally: Total Paid uses only confirmed payment amounts, Outstanding excludes completed payments, overdue uses the original invoice due date, approval aging uses assignment timestamps, and currencies are never mixed without USD conversion. Each report exports to CSV, XLSX (via SheetJS), and PDF, stamped with the generation time and the selected filter criteria; exports run through the same permission check and filters as the on-screen data. Drill-down moves from KPI cards to the relevant report table and from any transaction row to its full payment detail.

## Notifications and background worker

Notifications are scoped to each active user. The notification bell and **Notifications** page provide unread counts, read status, category/date filters, pagination, and links to the related request. The profile timezone preference is used to display notification timestamps; timestamps are stored in UTC.

Email messages use JSAN-branded templates and a database-backed outbox. Failed deliveries are retried with exponential backoff (up to five attempts); pending email and reminder state survives application restarts. Configure SMTP through the authorized **Notification settings** page or the existing `SMTP_*` environment variables. Admin-entered SMTP passwords are encrypted at rest; set a persistent `NOTIFICATION_SECRETS_KEY` on every app and worker instance before saving a password. Do not rotate or lose this key without first migrating the stored SMTP credential. SMTP credentials and the encryption key are never returned by the settings API.

Administrators can edit distinct templates for request submission, approval assignment, approval reminders, clarifications/returns, approval confirmation, rejection, payment confirmation, and AP updates. Category controls independently enable or disable groups of in-app and email notifications.

Run the persisted-job worker under a process supervisor in each production deployment:

```powershell
npm run notifications:worker
```

The worker polls the database every 30 seconds for scheduled approval reminders, due/overdue AP notifications, and retryable email. It should be kept running independently of web requests (for example, as a Windows service or a supervised container process). Starting the Next.js app alone does not run scheduled jobs. No browser timer is used.

Notification endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/notifications` | Current user's paginated notification history; supports `type`, `from`, `to`, `unread`, `page`, and `pageSize` |
| PATCH | `/api/notifications` | Mark one current-user notification read, or all current-user notifications read |
| GET | `/api/admin/notifications` | Admin-only category, reminder, SMTP-safe status, template, and delivery-log settings |
| PATCH | `/api/admin/notifications` | Admin-only notification settings and template updates |
| POST | `/api/admin/notifications` | Admin-only test email delivery |

Email delivery is asynchronous and requires the worker. Deploy and apply the notification database migration after the earlier payment-processing migration before starting web or worker processes.

Entities, currencies, cost centers, projects, and exchange rates are managed under **Payment settings** by users with `payments:manage_masters`. Exchange rates are entered by an authorized administrator as USD per one unit of foreign currency, with a source and effective date. USD is treated as the base currency at 1:1; no other rate is guessed or hardcoded. A request submission uses the latest configured rate effective on or before its invoice date and saves the rate, source, and effective date used. Missing rates block submission.

Invoices and attachments accept PDF, XLS, XLSX, and JPG/JPEG, with extension, MIME type, and file-signature checks. Files are stored outside the public directory under random private storage keys. Downloads and previews are served through authenticated routes after owner/AP permission checks. Configure persistent private storage before production deployment; multi-instance deployments need shared private object storage or a shared private volume.

The duplicate guard normalizes vendor, invoice number, and invoice value and stores a unique fingerprint for submitted requests. The database unique constraint prevents concurrent duplicates; drafts do not reserve an invoice fingerprint.

`platform:admin` and `reports:access` are not included in any standard role. Platform administrators grant them as explicit per-user permissions from the employee screen in **User management** (at creation or via **Manage access**). Both pages and API handlers check permissions on the server; hiding a navigation link is not an authorization boundary. Employee profile, role, status, and permission endpoints are independent of frontend checks. All administrative and payment-sensitive actions are recorded in the centralized audit log (`/admin/audit`, `platform:admin` only).

## API endpoints

| Method | Endpoint | Purpose / access |
|---|---|---|
| `POST` | `/api/auth/login` | Sign in with employee email and password |
| `POST` | `/api/auth/logout` | Revoke the current database session |
| `GET` | `/api/auth/session` | Return the current safe session identity |
| `POST` | `/api/auth/activate` | Activate an invited account and set its password |
| `POST` | `/api/auth/forgot-password` | Request a password-reset link |
| `POST` | `/api/auth/reset-password` | Consume a reset link and update the password |
| `GET` | `/api/users` | Search/filter/paginate employees; requires `users:read` |
| `POST` | `/api/users` | Create an active employee with a role and password (plus optional admin-granted permissions); requires `users:invite` and `users:assign_role` |
| `GET`, `PATCH` | `/api/users/me` | Read or update the signed-in employee's own profile |
| `PATCH` | `/api/users/[id]/role` | Assign a standard role; requires `users:assign_role` |
| `PATCH` | `/api/users/[id]/status` | Activate/deactivate an account; requires `users:activate` |
| `PATCH` | `/api/admin/users/[id]/permissions` | Grant/revoke direct permissions from the employee screen; requires `platform:admin` |
| `GET` | `/api/admin/audit` | Read the centralized audit log with filters/pagination; requires `platform:admin` |
| `GET` | `/api/health` | Unauthenticated liveness/readiness probe (database check); no business data |
| `GET` | `/api/payment-masters` | Read active dropdown values and configured exchange rates; requires payment request access |
| `POST`, `PATCH` | `/api/payment-masters` | Create or deactivate entities, currencies, cost centers, projects, and rates; requires `payments:manage_masters` |
| `GET`, `POST` | `/api/payment-requests` | Filter/paginate permitted requests or create a draft; POST requires `payments:create` |
| `GET`, `PATCH` | `/api/payment-requests/[id]` | Read an authorized request or update/submit an owned draft |
| `POST`, `DELETE` | `/api/payment-requests/[id]/documents` | Upload or remove documents on an owned draft |
| `GET` | `/api/payment-documents/[id]` | Download or preview an authorized invoice/attachment |
| `GET` | `/api/ap/reviews` | Filtered AP review queue; requires `ap:access` |
| `POST` | `/api/payment-requests/[id]/workflow` | Start AP review, forward, return, reject, approve, or request clarification; action-specific AP/approver permission and status checks |
| `GET` | `/api/ap/management` | AP dashboard metrics and filter options; requires `ap:access` |
| `GET` | `/api/ap/payments` | Approved unpaid queue with filters, sort, pagination, or `?export=csv`; requires `ap:access` |
| `GET` | `/api/ap/payments/[id]` | Read eligible payment confirmation details; requires `ap:access` |
| `PATCH` | `/api/ap/payments/[id]/schedule` | Set or clear an approved request's planned payment date; requires `ap:access` |
| `POST` | `/api/ap/payments/[id]/confirm` | Record an external payment and privately store proof; requires `ap:access` |
| `POST` | `/api/ap/payments/[id]/corrections` | Correct a paid record with reason and audit snapshots; requires `ap:access` and `payments:correct` |
| `GET` | `/api/ap/calendar` | Filter upcoming, due, overdue, Wednesday-scheduled, and completed payments; requires `ap:access` |
| `GET` | `/api/ap/projects` | Project payment totals and invoice/payment filters; requires `ap:access` |
| `GET` | `/api/payment-calendar` | Role-scoped calendar entries with live categories and Wednesday cycles; supports `from`, `to`, `vendor`, `projectId`, `category` |
| `GET` | `/api/payment-calendar/upcoming` | Approved payments grouped by scheduled Wednesday with currency- and project-wise totals; supports `from`, `to`, `vendor`, `projectId` |
| `GET` | `/api/payment-calendar/summary` | Role-scoped financial tracking: upcoming, due-this-week, overdue, at-risk, paid, and outstanding USD totals and currency/project/vendor breakdowns |
| `GET` | `/api/management/dashboard` | KPI cards, trend/status/currency/project charts, and filter options; requires `reports:access`; supports the global filters below |
| `GET` | `/api/management/reports/[type]` | `summary`, `project`, `vendor`, `aging`, `upcoming`, `overdue`, or `history` report as JSON, or `?format=csv\|xlsx\|pdf` download; requires `reports:access` |
| `GET` | `/api/approvals` | Assigned approval records and dashboard metrics; requires `approvals:access` |
| `GET`, `PATCH` | `/api/approval-matrix` | Read or assign USD-band approvers; requires `payments:manage_masters` |
| `GET`, `PATCH` | `/api/notifications` | Read or mark the signed-in user's in-app notifications |

`POST /api/payment-requests/[id]/workflow` accepts one of these actions: `start_review`, `send_approval`, `clarification`, `return`, or `ap_reject` for AP; `approve`, `reject`, or `request_clarification` for the currently assigned approver. Rejection, return, and clarification actions require a non-empty `comment`. The endpoint enforces the current payment status and permission on the server and writes the status transition, audit event, assignment resolution, and notifications transactionally.

Payment list filters include full-text search, status, project, vendor, submission-created date range, sorting, and pagination. Payment detail includes the request snapshot, documents, financial conversion details, requestor, AP and approval actions, assignment history, clarification comments, the payment schedule (scheduled date, earliest eligible date, and risk status), the immutable scheduling history, payment confirmation, authorized payment proof, correction snapshots, and immutable request history.

The future Microsoft 365 integration is not assumed or enabled. The current credential-based sign-in is isolated behind auth endpoints so an identity provider can be added as a distinct provider without weakening the existing authorization checks.

## Database

`prisma/schema.prisma` defines the identity/authentication, payment request, AP and approval workflow, approval threshold/assignment, approval comment, clarification, notification, payment schedule, payment schedule history, payment confirmation, payment correction, audit log, and master-data models. The `AuditLog` model is an append-only, centralized record of security-, administration-, and payment-sensitive events (actor, action, entity, previous/new values, IP, and timestamp); the application never updates or deletes audit rows, and a deleted actor is nulled while the captured details are retained. The payment schedule carries the scheduled payment date, earliest eligible date, and a `PaymentRiskStatus` (`ON_TRACK`/`AT_RISK`) alongside the original invoice due date; `PaymentScheduleHistory` retains an append-only record of every scheduling calculation and change. Payment amounts and thresholds use PostgreSQL decimal types; duplicate fingerprints, transaction IDs, one-confirmation-per-request, and payment references have database uniqueness constraints. SQL migrations live under `prisma/migrations`; use `npm run db:migrate:dev` to create a migration during development and `npm run db:migrate` to apply committed migrations. Run the idempotent `npm run db:seed` after upgrading to ensure role permissions are assigned.

## Validation

- `npm test` runs focused unit tests.
- `npm run test:integration` runs PostgreSQL-backed endpoint/permission flows while the app is running and `DATABASE_URL` is set.
- `npm test` includes exact approval-band boundary, unconfirmed-band, and missing/overlapping configuration tests.
- `npm test` includes the payment-scheduling engine: Wednesday rolling, the seven-day minimum, month-end and year-end crossings, every submission weekday, at-risk detection, and the required 04-Nov-2026 → 11-Nov-2026 case.
- `npm run test:integration` includes payment-calendar flows: approval auto-scheduling, at-risk flagging, role-scoped calendar access, pending-vs-overdue handling, seven-day minimum enforcement on manual reschedule, and USD financial summaries.
- `npm test` includes management-report calculations: KPI aggregation, aging buckets, currency/project/vendor totals, overdue-vs-upcoming, and the April–March financial year.
- `npm run test:integration` includes management-dashboard flows: `reports:access` enforcement, KPI accuracy against real records, approval aging/overdue/upcoming reports, CSV/XLSX/PDF exports, and date-range filtering. Integration tests run with `--test-concurrency=1` because they share one database and application instance.
- `npm run test:integration` includes audit-log coverage (admin-only read, append-only, employee lifecycle and payment events) and the `/api/health` probe plus baseline security headers.
- Payment proof signature/type validation is covered by unit tests. PostgreSQL integration tests exercise authenticated request, AP, and approval flows; payment confirmation requires a migrated test database and running application.
- `npm run lint` runs ESLint.
- `npx tsc --noEmit` checks TypeScript.
- `npm run build` validates the production build.

Database-backed authentication and payment API flows require a PostgreSQL instance, applied migrations, and seeded roles/permissions. Payment integration tests require the app server to be running with the same `DATABASE_URL` and `PAYTRIVA_UPLOAD_DIR`. Email delivery requires the SMTP settings above. The $40,000–$49,999.99 approval band and all other matrix assignments require business/admin configuration before eligible requests can be forwarded. PAYTRIVA records external payment confirmations only; initiating payments, bank integration, and email reminders are not implemented.

## Security and operations

The application emits baseline security headers on every response — Content-Security-Policy, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy` (configured in `next.config.ts`). Sessions use `HttpOnly`, `Secure` (production), `SameSite=Lax` cookies with hashed opaque tokens; passwords are bcrypt-hashed; all queries use Prisma's parameterized API and React escapes output. `GET /api/health` is an unauthenticated liveness/readiness probe that checks database connectivity and returns no business data.

Operational references live in `docs/`:

- `docs/DEPLOYMENT.md` — production environment, migrations, running the app and the notification worker, HTTPS/reverse proxy, and health checks.
- `docs/BACKUP_RECOVERY.md` — database and private document-store backups, retention, and the tested restore procedure.
- `docs/PRODUCTION_READINESS.md` — the audit findings, security review, data-integrity validation, test results, go-live checklist, and known limitations.
