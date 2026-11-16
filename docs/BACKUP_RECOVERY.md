# PAYTRIVA — Backup & Recovery

PAYTRIVA's state lives in two places that must both be backed up and restored together:

1. **PostgreSQL database** — all payment requests, approvals, confirmations, corrections,
   notifications, audit logs, users, and configuration.
2. **Private document store** (`PAYTRIVA_UPLOAD_DIR`) — uploaded invoices, attachments, and
   payment proofs. The database stores only metadata and storage keys; **document files
   cannot be reconstructed from the database.**

A restore is only consistent if the database backup and the document-store backup are from
the same point in time.

## 1. Database backups

### Automated backups

- **Managed PostgreSQL:** enable automated daily snapshots plus point-in-time recovery
  (PITR / WAL archiving). This is the recommended option.
- **Self-managed:** schedule a nightly logical dump and retain WAL for PITR:

  ```bash
  pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" \
    --file="paytriva-$(date +%F).dump"
  ```

Store dumps encrypted, off-host, with restricted access. Never store them in a
web-accessible location.

### Retention

- Daily backups retained **30 days**.
- Weekly backups retained **12 weeks**.
- Monthly backups retained **12 months** (adjust to JSAN's financial-records policy).
- PITR window of at least **7 days** where supported.

## 2. Document store backups

- Back up `PAYTRIVA_UPLOAD_DIR` on the **same schedule** as the database.
- Prefer object storage with versioning and lifecycle rules, or a snapshot of the private
  volume. Keep it private (no public ACLs) and encrypted at rest.
- Match the retention policy to the database so restores stay consistent.

## 3. Configuration backup (without secrets)

- Keep `.env.example`, `prisma/schema.prisma`, and `prisma/migrations/` in version control.
- Record the **names** of required environment variables (see `DEPLOYMENT.md`) in a runbook,
  but store their **values** only in the platform secret manager.
- **Never** back up `.env`, SMTP passwords, `NOTIFICATION_SECRETS_KEY`, or session data into
  shared or unencrypted locations. `NOTIFICATION_SECRETS_KEY` must be preserved securely —
  losing it means re-entering the SMTP password in Notification settings.

## 4. Recovery procedure

1. **Provision** a database and app environment matching the target version.
2. **Restore the database:**

   ```bash
   # Logical dump
   pg_restore --no-owner --clean --if-exists --dbname="$DATABASE_URL" paytriva-YYYY-MM-DD.dump
   # or restore the managed snapshot / PITR target to the same timestamp as the file backup.
   ```

3. **Restore the document store** to `PAYTRIVA_UPLOAD_DIR` from the matching-time backup.
4. **Reconcile the schema:** run `npm run db:migrate` to apply any migrations newer than the
   backup, then `npm run db:seed` (idempotent — it never resets existing data or passwords).
5. **Set secrets** (`NOTIFICATION_SECRETS_KEY`, SMTP, `DATABASE_URL`) from the secret store.
6. **Start** the web app and the notification worker.
7. **Validate** (see below).

## 5. Restore validation (run after every drill)

- `GET /api/health` returns `200` with `database: true`.
- A known administrator can log in.
- Spot-check a paid payment request: its **documents and payment proof download**, and its
  **confirmation, correction history, and audit entries** are present.
- Row counts for `PaymentRequest`, `PaymentConfirmation`, and `AuditLog` match the source.
- No `PTR-DEMO-*` records exist in production.

## 6. Recovery testing

- Perform a **quarterly** restore drill into an isolated environment using the latest
  backups. Record the restore time (RTO) and the data-loss window (RPO).
- Target objectives (tune to JSAN requirements): **RPO ≤ 24h** (≤ minutes with PITR),
  **RTO ≤ 4h**.
- File a short report after each drill noting any gaps and fixes.

## 7. What must never happen

- Do not delete or overwrite existing transaction records outside the authorized correction
  workflow. Backups are recovery tools, not a way to edit history.
- Do not restore a database backup without the matching document-store backup (or vice
  versa) into production — it produces dangling document references.
