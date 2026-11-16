# PAYTRIVA Backup and Recovery

This runbook is for operators with authorized access to the production database and private document volume. It does not configure or run production backups. Configure backups in the hosting provider or a restricted operations environment before launch.

## What must be protected

- PostgreSQL database, including schema, migration history, payment and approval history, and audit records.
- The complete private upload directory configured by `PAYTRIVA_UPLOAD_DIR`. Invoice and payment-proof files are not recoverable from database metadata alone.
- Secret values from the deployment secret manager, including database credentials, SMTP credentials, `NOTIFICATION_SECRETS_KEY`, and application signing secrets. Export them only through an approved encrypted secret backup process; never place them in a database dump, source control, or ordinary file backup.
- Deployment configuration and migration version, without embedding secrets.

Use encrypted backups with access controls and off-site or provider-independent copies. Apply retention and deletion policies approved by the organization. Record the selected RPO, RTO, retention period, backup owner, and restore owner in the operations runbook.

## Backup procedure

Prefer provider-managed, point-in-time PostgreSQL backups and consistent snapshots of the private upload volume. Confirm that both services report successful backups and that retention meets organizational policy.

For an authorized manual PostgreSQL backup from a protected operations host, configure libpq connection variables through the secret manager and use a `PGPASSFILE` protected by restrictive Windows ACLs. Do not pass a credential-bearing connection URL on the command line:

```powershell
$env:PGPASSFILE = "D:\PaytrivaSecrets\pgpass.conf"
$env:PGHOST = "<database-host>"
$env:PGPORT = "<database-port>"
$env:PGUSER = "<backup-role>"
$env:PGDATABASE = "<database-name>"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDirectory = "D:\PaytrivaBackups"
New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
$databaseBackup = Join-Path $backupDirectory "paytriva-$timestamp.dump"
pg_dump --format=custom --no-owner --file="$databaseBackup" --dbname="$env:PGDATABASE"
if ($LASTEXITCODE -ne 0) { throw "Database backup failed." }
Get-FileHash -Algorithm SHA256 $databaseBackup
```

Copy the database dump and private document volume using the approved encrypted backup mechanism. Capture them from a consistent point: use provider snapshots coordinated to the same recovery point, or briefly stop writes and the notification worker while taking the database and volume snapshots. Record the UTC timestamp, migration version, checksums, and backup outcome in the restricted operations log. Do not print connection strings or secret values.

Backups must be monitored for completion and retention. Alert an operator on missed schedules, failed uploads, checksum mismatches, or insufficient backup capacity.

## Restore verification (isolated environment only)

Run restore drills in an isolated, access-restricted environment with outbound email disabled and no connection to production services. Never point `pg_restore` at the production database.

1. Provision a disposable PostgreSQL database and isolated private upload volume with sufficient capacity.
2. Retrieve a database dump and matching document backup through the approved access process; verify the dump checksum.
3. Set `DATABASE_URL` to the disposable database. Restore the dump:

   Configure `PGPASSFILE`, `PGHOST`, `PGPORT`, `PGUSER`, and `PGDATABASE` for the isolated restore database using protected credentials. Do not put a credential-bearing URL in command arguments.

   ```powershell
   pg_restore --exit-on-error --no-owner --dbname="$env:PGDATABASE" "D:\PaytrivaBackups\paytriva-<timestamp>.dump"
   if ($LASTEXITCODE -ne 0) { throw "Database restore failed." }
   ```

4. Restore the matching private upload volume to the isolated volume and set `PAYTRIVA_UPLOAD_DIR` accordingly.
5. Apply only migrations that are newer than the restored database using the standard deployment process. Do not rerun seeding with production credentials or seed example financial records.
6. With SMTP and all external delivery disabled, verify migration status, application startup, representative transaction/history records, private document existence and authorized document retrieval, and audit records.
7. Record the restore duration, recovered timestamp, verification results, defects, and cleanup confirmation. Securely dispose of the isolated database, volume, and temporary backup copies under the approved retention policy.

Perform and document an initial restore drill before production sign-off, then repeat it at the cadence required by organizational policy and after material storage or schema changes.

## Recovery limitations and ownership

- A database-only restore can leave document references whose files are missing. Restore the database and private upload snapshot from the same recovery point.
- Loss or rotation of `NOTIFICATION_SECRETS_KEY` can make stored SMTP credentials unreadable. Recover the matching key from the secret manager; do not rotate it without migrating encrypted credentials.
- This repository does not select a cloud provider, retention interval, RPO/RTO, or production backup schedule. Those require an operations owner and deployment-specific configuration.
