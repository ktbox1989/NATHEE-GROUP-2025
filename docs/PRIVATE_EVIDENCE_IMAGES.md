# Private motorcycle evidence images

Motorcycle evidence is not Public Gallery content. Every image request requires a real authenticated actor and the existing `images:read` company authorization. R2 objects stay private and responses use `private, no-store`, `nosniff` and inline delivery.

## Storage contract

Each new upload stores:

- the unchanged original image as the evidentiary source;
- a required WebP `DISPLAY` derivative with a maximum long edge of 1,600 pixels and a 3 MB server limit;
- a required WebP `THUMBNAIL` derivative with a maximum long edge of 640 pixels and a 1 MB server limit;
- optional AVIF derivatives when the browser can encode them.

The API validates the declared MIME signature, byte size, dimensions and SHA-256 metadata. The grid requests `role=thumbnail`; inspection and POD links request `role=display`; `role=original` is explicit. A browser receives AVIF/WebP only if its `Accept` header supports that format. An existing image without derivative metadata falls back to its unchanged original and returns `X-Nathee-Image-Variant: original-fallback`.

## Idempotency and failure safety

The browser creates one cryptographically secure `motorcycle-image-<uuid>` request key and retains it across a safe retry. Migration `0020_awesome_quentin_quire.sql` adds a database unique index, so concurrent requests cannot create two canonical image rows. R2 writes occur before the atomic D1 metadata/Audit batch; a failure removes only the newly written keys. If another request already committed the same request key, the loser removes its own objects and returns the canonical row.

Image and variant metadata is immutable and cannot be hard-deleted. No migration backfill rewrites an original object and no old row is removed.

## Migration and acceptance

Before Production:

1. Create and verify a D1 backup and R2 inventory/checksum report.
2. Dry-run migrations through `0020` on a restored isolated copy; verify original image row counts and `PRAGMA foreign_key_check`.
3. Apply `0020` exactly once using the migration ledger.
4. Upload one real image through a permitted STAFF account and verify one original, required Display/Thumbnail metadata, SHA-256 values, Audit and private R2 access.
5. Retry the same request key and prove no second row/object set appears.
6. Verify the owning CUSTOMER can render the thumbnail/display and another company receives the same not-found response.
7. Test 320/375/390 mobile widths and inspect network byte sizes; legacy evidence may legitimately report `original-fallback` until a separately reviewed derivative backfill exists.

Rollback before apply is a code revert. After apply, keep the additive schema or use a reviewed forward migration. Never delete original evidence, variant metadata or Audit history to roll back a client release.
