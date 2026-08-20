# Private signed Proof of Delivery

This contract applies to POD records created after migration
`0021_zippy_impossible_man`. It does not invent signatures for historical
records and never makes a public Gallery image stand in for delivery evidence.

## Evidence boundary

A new POD requires the real recipient name, delivery location and time, one
private same-motorcycle image categorized as `DELIVERY`, a drawn recipient
signature and explicit operator attestation. The browser creates a PNG only at
submission time and does not keep it in local storage. Cancellation or a
network error never displays a confirmed state.

The server checks request origin, authenticated role, company permissions,
motorcycle state, image ownership/category, PNG file signature, actual IHDR
dimensions, byte bounds and SHA-256. Client-reported dimensions are accepted
only when they equal the dimensions inside the PNG. It writes the signature to
private R2 before atomically inserting the POD, signature metadata and a
redacted Audit event in D1. A failed database write deletes only that attempt's
new object. Request-key races return the existing canonical POD.

Signature downloads require `documents:read` for the matching company and use
`private, no-store` plus `nosniff`. A checksum, signature ID and existence flag
may appear in Audit; signature bytes, recipient phone and storage credentials
must not.

## Migration and compatibility

Migration `0021` adds `signature_required` with a legacy default of `0` and an
immutable `proof_of_delivery_signatures` metadata table. Existing POD rows stay
byte-for-byte attributable and may complete their prior lifecycle. Every new
POD insert must set `signature_required=1`, and D1 blocks `DELIVERED` until its
active POD has a matching signature. Signature rows cannot be updated or hard
deleted.

Before applying, take a complete D1 backup and record counts for motorcycles,
PODs and Audit. Dry-run the exact migration against a restored copy, verify
legacy `signature_required=0`, foreign keys, triggers and row counts, then apply
once through the migration ledger. Rollback after apply is restore-from-backup
or a reviewed forward migration; do not delete signature/POD evidence.

## Runtime acceptance

Source/build verification does not prove real signing. With the accepted Auth,
D1 and private R2 runtime, test on mobile and desktop: draw, clear, resubmit,
cancel, retry with the same request key, open the authorized signature and
print the document. Confirm cross-company and anonymous reads return the same
non-disclosing failure, an unsigned new POD cannot reach `DELIVERED`, and no
orphan object remains after a forced D1 failure. This acceptance is still
pending while the full application runtime is not Production-live.
