# Production quotation boundary

Updated: 2026-08-21

## Runtime split

- `public-site/quotation/` is part of the static Z.com website. It may show verified telephone and Owner-supplied LINE contact methods, but it must not claim that an online request was stored.
- The real online form is `/quotation` in the full Cloudflare application. `POST /api/quotation` requires the canonical same-origin runtime and D1 binding `DB`.
- Do not copy the API route or application source into Z.com `public_html`. Z.com is the public-static component only.

## Durable write contract

Migration `0015_graceful_ben_urich` adds:

- a unique public `request_key` for concurrent/retried submission idempotency;
- an explicit source and consent timestamp;
- database triggers requiring consent for `PUBLIC_WEBSITE` submissions;
- immutable submission identity; and
- a hard-delete prohibition for quotation records.

The server validates and bounds every submitted field, rejects a honeypot value, requires a server-validated Cloudflare Turnstile token and records no success until the quotation and a redacted Audit Log commit together. It then returns the generated `QT-YYYY-NNNNNN` reference. Audit JSON excludes name, telephone, email, LINE ID, route and notes.

Turnstile is fail-closed. Both `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and server-only `TURNSTILE_SECRET_KEY` must pass format checks before the form is rendered or `/api/health` can pass. The API posts the token to Siteverify with a UUID idempotency key, a five-second timeout and at most one safe retry; it accepts only `success=true`, action `quotation` and the exact configured application hostname. The secret never enters a public environment name, URL, rendered page, Audit record or repository value. Tokens remain single-use and expire according to [Cloudflare's server-side validation contract](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

The authenticated inbox `/app/quotations` is OWNER-only. It is keyset-bounded to 50 records and status changes write an Audit Log in the same D1 batch. Other roles receive no navigation item and are redirected by the server.

Migration `0016_numerous_shatterstar` adds private quotation attachments without rewriting an existing quotation:

- at most five files, 8 MB each and 20 MB combined;
- allowlisted PDF, UTF-8 CSV, XLSX, JPEG, PNG, WebP, AVIF, HEIC and HEIF with extension/MIME/signature agreement;
- private R2 bytes and immutable D1 filename, type, byte size, storage key and SHA-256 metadata;
- per-quotation checksum uniqueness, no hard delete and no metadata rewrite; and
- OWNER-only forced download with `nosniff`, no-store and a mandatory Audit record before bytes are served.

The upload path writes unique R2 keys first, commits the quotation, every attachment row and redacted submission Audit in one D1 batch, and compensates by deleting only those newly written keys if D1 fails or a concurrent request key wins. A cleanup failure is fail-closed and never reports a saved request. Original filenames and contact values are not copied to submission Audit JSON. Uploaded files remain untrusted external input: the Owner UI warns before download, and Production activation still requires an approved anti-abuse/malware-handling policy.

## Production activation gates

Before exposing the online form:

1. Back up Production D1 and verify the migration ledger through `0014`.
2. Dry-run then apply migrations `0015` and `0016` in order to the protected D1 runtime.
3. Configure and verify canonical `APP_ORIGIN`, Supabase Auth, real OWNER mapping and R2 readiness.
4. Verify `/api/health` includes the quotation and attachment tables, unique indexes and all five safety triggers.
5. Submit one authorized test request with a PDF and CSV through the real browser, verify the D1 rows, SHA-256/R2 objects and redacted Audit Log, then download each attachment from the OWNER inbox and update the request status.
6. Verify a repeated request key returns the same reference and never creates a second row.
7. Create the Turnstile widget for the canonical hostname, set its site key and secret through the secure hosting channel, and verify `/api/health.checks.antiAbuse=true`. Keep the reviewed untrusted-file handling policy before advertising the form broadly. No provider credential or bypass is stored in this repository.

Until every gate passes, deploy only the improved static sales pages. The static quotation page remains an honest telephone/LINE conversion path.
