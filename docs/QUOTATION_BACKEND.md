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

The endpoint also requires a real `multipart/form-data` boundary and an explicit positive `Content-Length` within the 22 MB request budget before parsing the body. A missing or malformed length cannot be treated as zero, and an oversized request cannot reach attachment decoding or D1/R2 work.

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

## Frontend contract, reconciled against the live endpoint

`lib/public-forms/quotation-contract.ts` is the consumer side: what the browser
sends, what it accepts back, and when it may tell a customer the enquiry was
received. It was reconciled field by field against `app/api/quotation/route.ts`
and `lib/quotation.ts` at `main` `74d88b4`.

The earlier version described a plausible JSON API that the server does not
implement. Four differences were real, and each would have been a live defect
the day the form was switched on.

### Finding 1 — the request key was rejected before reaching D1

`parseQuotationForm` requires `quote-<uuid v4>` and slices the `quote-` prefix
off to use as the Turnstile idempotency key, so the prefix is load-bearing.
The frontend emitted 32 bare hexadecimal characters, which fails that pattern.

Every submission would have been refused as `error=invalid` — and refused in
the way that is hardest to diagnose, because it is indistinguishable from the
customer having filled the form in wrongly. Fixed: `createRequestKey` emits the
server's format, `isWireRequestKey` states the rule, and
`buildQuotationFormData` throws on a malformed key rather than letting it reach
the network.

### Finding 2 — success is a 303 redirect, not a JSON acknowledgement

The endpoint answers a stored enquiry with `303` to
`/quotation?submitted=QT-YYYY-NNNNNN`, and a failure with
`/quotation?error=<code>`. There is no acknowledgement object and no echoed
request key, so the frontend cannot match a key to prove the answer is its own.

The binding is the response chain instead: this is the answer to this POST. A
`?submitted=` value read off the address bar is attacker-supplied and proves
nothing, so `reduceSubmission` takes the URL the submission's own response
resolved to. Success additionally requires the reference to be a real business
number (`QT-\d{4}-\d{6}`); a bare 200, an HTML page, a redirect with no
parameter, or a rewritten value are all failures.

All ten server failure codes — `invalid`, `consent`, `bot`, `challenge`,
`file_count`, `file_size`, `file_type`, `file_name`, `save`, `cleanup` — are
answered explicitly, and a code the frontend has never seen is treated as a
generic retryable failure rather than mistaken for anything else.

### Finding 3 — the field set and its bounds were both wrong

The server accepts `companyName`, `lineId`, `vehicleType`, `desiredDate` and
repeated `extras` entries; none were modelled. It also expects the honeypot
field `website` to be present and empty, and `privacyConsent` to be the literal
string `yes`.

The bounds were wrong in both directions, and each direction costs something:

| Field | Server | Was | Consequence |
| --- | --- | --- | --- |
| `origin` / `destination` | 180 | 200 | the tail is `slice()`d off in silence |
| `notes` | 1500 | 2000 | the end of the customer's message never arrives |
| `quantity` | 10,000 | 500 | a dealer moving a full shipment is refused |

The server truncates rather than rejecting, so a looser client bound is data
loss with no error anywhere. Every bound now mirrors the server's, and the
tests assert the vehicle-type and extras lists are literally the server's
exported constants so they cannot drift apart.

### Finding 4 — new/used is not expressible

There is no column for vehicle condition in `quote_requests` and no field for
it in `parseQuotationForm`; an unknown form field is discarded without comment.
The form therefore does not ask, because a question whose answer is thrown away
is worse than an absent one. `UNMAPPABLE_QUOTATION_FIELDS` records the omission
as a tested decision, and a test asserts the field is never sent.

**Lane B gate:** collecting new/used needs a column and a parser field on the
server side. Until then the customer can state it in `notes`.

### Origin note

`POST /api/quotation` calls `isSameOrigin` first and answers a cross-origin
request with a bare `403` before parsing anything. The form must therefore be
served from the application origin; a form on the public apex posting across to
`app.natheegroup2025.com` would fail every time.
`QUOTATION_ENDPOINT_REQUIRES_APP_ORIGIN` states this where the form gets wired
up, because it is a deployment decision rather than a form detail.

### Attachments

`validateQuotationAttachments` mirrors the server's count, per-file, combined
and extension limits — including CSV and XLSX, so a dealer can attach a vehicle
list rather than retyping it. It is a courtesy to the person choosing the files:
the server re-checks all of it and additionally reads each file signature, which
a browser cannot be trusted to do.
