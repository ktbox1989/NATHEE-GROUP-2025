# Operational reports and Audit pagination

## Truthful reporting boundary

`/app/reports` is a current-state operational report. Every number is calculated
from D1 at request time. An absent status remains absent; the UI never inserts a
sample KPI, estimate, target, price, invoice or accounting value.

Authorized customer roles see only grouped Job and Motorcycle status counts for
their own company. Authorized internal roles may additionally see Trip,
Container and current Yard counts. The report can be printed or saved as PDF by
the browser and states its render time.

Finance, profit, SLA and duration reports remain unavailable until their source
tables, business definitions and approval policies are accepted.

## Audit scale contract

The Audit UI uses descending `(created_at, id)` keyset pagination with 50 rows
per request. It never loads the full history or uses an offset that becomes
slower as the ledger grows.

Migration `0019_supreme_imperial_guard.sql` adds only
`idx_audit_logs_created_id`. It does not update, delete or rebuild an Audit row.
The migration test inserts pre-existing history, applies `0019`, proves the row
is preserved and requires the pagination query plan to use the new index.

## Production gate and rollback

Before applying `0019`, create and verify a D1 backup and dry-run the complete
migration chain against a copy. Runtime readiness requires the new index and
must stay degraded while it is absent.

Before Production application, rollback is a source revert. After application,
prefer a forward migration; restoring the reviewed pre-migration D1 backup is
the full rollback. Do not delete Audit history.
