# PAYTRIVA Audit Log

## Access and endpoint

The audit page is available at `/admin/audit` to users with the explicit `platform:admin` permission. The API is `GET /api/admin/audit` and requires the same permission on every request.

Supported query parameters:

- `page` (1-based, default `1`)
- `pageSize` (default `25`, maximum `100`)
- `search` (actor name, entity type/ID, or summary)
- `action` (case-insensitive substring)
- `from` and `to` (timestamps; ISO-8601 UTC recommended)

The API returns `{ entries, total, page, pageSize }`, newest records first. Each entry contains actor identity, action, entity reference, summary, before/after values when applicable, timestamp, and available IP/user-agent context. Passwords, authentication tokens, and document bytes must never be written to audit values.

## Write behavior

Audit records are written with the audited change in the same database transaction where possible. Authentication events that do not alter a resource use the existing safe audit writer. Application routes expose no update or delete endpoint for audit records. The administrator page is read-only and paginated.

Application-level append-only behavior is not a cryptographic tamper-evidence guarantee: a database owner can alter records directly. Production operators should restrict database access, retain encrypted database backups, and monitor privileged access through the hosting provider's controls.

## Operational considerations

Audit entries may contain employee names, network addresses, user-agent strings, transaction identifiers, and financial workflow metadata. Restrict access to platform administrators, apply the organization's retention/privacy policy, and include audit data in protected database backups. IP capture uses request proxy headers; configure only trusted reverse proxies to supply those headers.
