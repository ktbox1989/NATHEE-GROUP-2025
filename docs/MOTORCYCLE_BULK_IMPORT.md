# Motorcycle Bulk Import

The authenticated operations application supports server-side CSV and XLSX imports for one active Transport Job at a time. An upload never creates motorcycles immediately. It creates an immutable validation batch and row ledger, shows every row to the authorized operator, and enables confirmation only when the batch has zero errors.

## File contract

- 1–500 non-empty data rows after one header row.
- CSV must be valid UTF-8 and no larger than 2 MiB.
- XLSX must be a valid bounded OOXML ZIP and no larger than 5 MiB.
- Native Excel formula cells are rejected; convert formulas to values before upload.
- At least one `vin`/เลขโครง or `engine_number`/เลขเครื่อง is required per row.
- Supported fields: make, model, variant, year, color, registration, province, VIN/frame number, engine number, NEW/USED/UNKNOWN condition and notes.
- Thai header aliases are supported. Unknown or duplicate semantic headers fail the whole upload.
- A canonical CSV template is available only after an authorized internal login.

The XLSX reader extracts only workbook, relationship, shared-string and worksheet XML entries. It rejects traversal paths, unsupported formulas, invalid row/cell references, too many ZIP entries and declared uncompressed content over 12 MiB before extracting the selected entries.

## Validation and idempotency

The server normalizes bounded text and identifiers, validates model year, marks every duplicate VIN/engine number inside the file and checks staged rows against the current motorcycle registry. `request_key` prevents a retried upload from creating another batch. `(job_id, checksum)` prevents the exact file from being staged twice for one Job.

Import metadata is retained in:

- `motorcycle_import_batches`
- `motorcycle_import_rows`

Both tables prohibit hard delete. Source identity and normalized row content are immutable. Validation errors remain available for reconciliation; the system never silently skips an invalid row.

## Confirmation transaction

Confirmation uses one D1 `batch()` plan. Cloudflare documents that batched statements execute sequentially as a transaction and roll back the sequence when a statement fails. The plan claims the batch once, allocates the complete sequence range, inserts motorcycles, initial status events and per-record Audit entries, advances an OPEN Job, marks all staged rows imported, closes the batch and runs a final fail-closed assertion. A uniqueness race therefore creates no partial motorcycles and consumes no sequence range.

The 500-row boundary is exercised against the exact SQL plan in an isolated SQLite database. The test verifies 500 contiguous sequences, 500 initial status events, 500 imported ledger rows, retry rejection and complete rollback on a late VIN conflict.

Official platform references:

- <https://developers.cloudflare.com/d1/worker-api/d1-database/#batch>
- <https://developers.cloudflare.com/d1/platform/limits/>

## Production activation

Migration `0017_parallel_spirit` is additive. It creates the import ledger, extends motorcycle records without rebuilding the existing table, preserves earlier lifecycle triggers and seeds each Job's sequence counter from the current maximum. It is not applied merely because the source builds.

Before activation:

1. Back up the Production D1 database and verify the migration ledger through `0016`.
2. Dry-run `0017` against a restored copy and compare motorcycle, status-event and sequence counts before/after.
3. Apply `0017` once, then verify required tables, indexes and triggers through `/api/health`.
4. Use an authorized internal account to upload a small real approved file, review all rows and confirm once.
5. Reconcile source count, imported motorcycles, initial status events and Audit entries before using a 50–500-row production batch.

Rollback before apply is a code revert. After apply, restore the reviewed D1 backup or create a forward migration; do not delete import, motorcycle, status or Audit history.
