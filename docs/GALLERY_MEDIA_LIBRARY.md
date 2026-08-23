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

The server does not trust browser-provided image geometry. It reads dimensions from the uploaded JPEG, PNG, WebP, AVIF, HEIC or HEIF bytes, rejects malformed or over-80-million-pixel artifacts and requires Display/Thumbnail claims to match exactly before saving immutable metadata. Candidate R2 keys are registered before each write; a failed D1/R2 path attempts every cleanup and reports uncertainty rather than silently succeeding.

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

## The public consumer contract

`lib/public-cms/gallery.ts` is the receiving end: what the public site will
render from this library, in what order, and what it does when one image is
broken.

### Two independent conditions, not one

An item reaches the public gallery only when it is **both** `PUBLISHED` **and**
`PUBLIC`, and only when every one of its sources still passes the public media
rules — same-origin, under `/assets/`, no traversal, and none of the
authenticated prefixes.

That duplication is the point. This library holds customer motorcycle
photographs, inspection findings, proof-of-delivery images and signatures
alongside the marketing portfolio. Publishing one of those is not a typo, it is
an incident, and a single mistyped visibility column should not be enough to
cause it.

`GALLERY_VISIBILITY_IS_PUBLIC` writes out every visibility and whether it may
be shown, rather than testing `!== PUBLIC`. A visibility added later is then a
decision someone has to make, instead of a value that silently defaults to
visible — and a test asserts every visibility the library defines has an entry.
An unrecognised value is refused.

### Ordering

Featured first, then the editor's order, then the id.

The id tie-break is new and is not cosmetic. Two items given the same order
number sort differently on each render without it, so "load more" shows one
photograph twice and hides another. An item whose order is missing or not a
number sorts last rather than first, because an unordered item appearing ahead
of the Owner's chosen lead image is the more expensive mistake.

### Filters

Only categories that actually have a published photograph are offered: a filter
leading to an empty grid is worse than no filter. Labels sort by the Thai
alphabet.

A link to a category the Owner has since emptied shows the **whole gallery**
rather than a dead end — a stale link is a normal event and the full portfolio
is a better answer than an empty page. An item with no category still gets a
label, never an empty caption.

### Failure

One unrenderable photograph is dropped and reported in `skipped`; the rest of
the gallery renders. An image with no alt text, no real dimensions, or no
JPEG/PNG fallback is not rendered at all — a broken `<img>` on a sales page
looks worse than one fewer picture.

`hasMore` is measured against how many items **matched**, not against how many
rendered, so a skipped item is not silently offered again by "load more".

When nothing can be shown the view says which of the three reasons applies:
nothing published, nothing in this category, or nothing in this category could
be rendered. They need different answers from the page.

### The lightbox

Stated as data — `LIGHTBOX_KEYS`, the gesture rule, the focus contract — so the
behaviour is testable without a browser and the static release cannot answer
different keys from a future rendered version.

- `Escape` closes, `ArrowLeft` and `ArrowRight` move.
- Navigation **wraps**, so no arrow key is ever dead, including with one image.
- Focus moves to the close button on open, `Tab` cycles within the dialog, and
  focus returns to whatever opened it on close.
- The position (`ภาพที่ 3 จาก 40`) is announced; a screen reader otherwise has
  no way to know how far through a set it is.
- The requested image loads **eagerly** at display size. The visitor asked for
  this exact photograph, so lazily loading it shows them an empty dialog.

### Swipe

The static lightbox now answers a horizontal swipe: left for the next
photograph, right for the previous. Most of this gallery is looked at on a
phone, where arrow buttons are the least natural way through forty images.

It is deliberately conservative. A drag shorter than 48px, or one that is more
vertical than horizontal, is someone scrolling and does not move the gallery —
a swipe handler that fires on a scroll attempt makes a page feel broken, which
is worse than not having one. The listeners are passive, so they never block
scrolling, and `touchcancel` resets the gesture. `scripts/test-responsive-layout.mjs`
asserts both halves: that the handlers exist, and that both guards are still
there.

This changes `public-site/assets/site.js`, so it reaches visitors only through
the guarded Z.com deployment — not through a content publish.
