# Gallery / Media Library

## Data boundary

Gallery marketing media and operational evidence are separate by design.

- `motorcycle_images` remains private evidence scoped to a customer company and motorcycle.
- `gallery_items` is a curated media record. It is never created by copying a customer image automatically.
- Public pages query only `status = PUBLISHED` and `visibility = PUBLIC`.
- Customer-job media requires both a matching `company_id` and `job_id`. A CUSTOMER can read it only after it is published and the existing company authorization succeeds.
- INTERNAL media is available only to OWNER or STAFF with `gallery:read`.

This boundary prevents an operational upload from becoming public merely because it exists in object storage.

## Permissions

- OWNER: all Gallery capabilities through the existing OWNER policy.
- `gallery:read`: open Media Library and preview non-public items.
- `gallery:write`: upload, edit, categorize, reorder, hide drafts and archive records.
- `gallery:publish`: publish/hide public or customer-job items and select public Featured images.
- CUSTOMER: no Gallery administration permission. Customer-job reads continue to require the customer's mapped company.

Publishing and editing a currently published record require `gallery:publish`. Archive is a soft-delete operation so audit history and recovery remain possible.

## Storage and variants

Each upload has an ORIGINAL, DISPLAY and THUMBNAIL variant in private R2. The browser prepares WebP and attempts AVIF when supported; the server independently validates file signature, type, byte limit and SHA-256 before recording metadata. A failed D1 batch triggers compensating deletion of newly written R2 objects.

The admin batch uploader accepts at most 20 images at a time and processes them sequentially to bound browser memory and network pressure. Each image requires its own factual title and Alt text. Decoding stops above 80 million pixels. A cancelled or partially failed batch never claims success: completed images remain Draft, the failed item is identified, and retry skips completed records.

Every queued image owns one secure `gallery-upload-<UUID>` request key for its entire retry lifetime. The API has a matching database unique index and returns the canonical row on duplicate/concurrent retry. The browser marks `DONE` only for HTTP 2xx JSON containing `ok=true`, a non-empty `galleryItemId` and a boolean duplicate flag; redirect HTML, incomplete JSON, Auth failure and validation failure remain visible errors. This prevents a followed redirect from fabricating a successful Draft.

The read route negotiates AVIF/WebP with `Accept`, sends immutable-style public caching only for public/published items, and sends `private, no-store` for authorized private items.

## Static Z.com release manifest

The current Z.com public website is static and cannot safely host D1/R2 admin logic. Its `/gallery/` route reads `public-site/assets/gallery.json` version 1. The deploy verifier checks:

- approved category identifiers;
- `PUBLISHED` status only;
- unique IDs, title, alt text, width and height;
- local files under `/assets/gallery/` only;
- no company IDs, customer IDs, VIN, registration or R2 storage keys;
- all referenced image files exist before deployment.

The current release source contains nine Owner-approved public work photographs with responsive JPEG/WebP display and thumbnail variants. The site-wide brand artwork and Owner-supplied LINE QR are separate public release assets. The QR remains byte-identical to the supplied file and is referenced without guessing a LINE account ID or external URL.

An empty manifest produces an honest empty state. It must not be replaced with stock images or invented work. When real photographs are supplied and publishing consent is confirmed, create responsive thumbnail/display files, update the manifest and rerun both public verifiers.

## Production gates

Migrations `0002`, `0003` and the Site Content integration in `0012` are source-only until the authenticated platform's D1 backup, dry-run, Auth setup and permission mapping pass. Do not expose `/app/gallery` or apply these migrations merely to make the static site appear complete.

Before activating the dynamic Media Library:

1. Back up Production D1 and record checksum/row counts.
2. Dry-run forward migrations on an isolated copy.
3. Apply migrations and verify existing `user_permissions` are preserved.
4. Grant Gallery permissions explicitly to approved STAFF; OWNER needs no row grants.
5. Upload one real image as Draft and verify ORIGINAL/DISPLAY/THUMBNAIL checksums.
6. Verify anonymous Draft access returns 404.
7. Publish one PUBLIC item and verify public access plus category/pagination.
8. Publish one CUSTOMER_JOB item and prove a different customer gets 404.
9. Hide and archive the test records, then verify audit history and rollback procedure.

Rollback is forward-only for schema. Application rollback can stop using Gallery tables without deleting media or history. R2 originals must not be bulk-deleted as part of a UI rollback.
