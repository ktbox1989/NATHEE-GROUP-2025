# Public media delivery

Where CMS-managed photographs are served from, stated as a contract.

This closes the open question in `docs/LANE_A_CONTRACT_ASKS.md` §2: `PostMediaResolver`
was a type with no production implementation, and the reason it had none was
that nobody had decided the host. Guessing one would have produced URLs that
pass every contract check and 404 for a visitor.

## The rule

A public media source is a **host-relative path under `/assets/media/`**.

```
/assets/media/<galleryItemId>/<role>.<ext>
```

| Segment | Values | Why |
| --- | --- | --- |
| `galleryItemId` | `[a-z0-9]` with single internal hyphens, 1–80 | Covers both identities that exist: the UUID a D1 upload gets, and the hyphenated id the Owner-supplied manifest uses. Narrow enough that a segment can never be a traversal, an encoded byte or a storage key. |
| `role` | `display`, `thumbnail` | `ORIGINAL` is deliberately absent. See below. |
| `ext` | `jpg`, `png`, `webp`, `avif` | The formats Lane A's contract can render. `heic`/`heif` are stored and never served. |

The mapping is defined once, in `lib/public-media-delivery.ts`, and is used in
both directions: the resolver builds paths with it and the route parses requests
with it. A path the contract could not have written is not answered — which is
what makes "only identities this application produced" a property rather than a
hope.

### Why not `/api/`

Lane A's public contract (`lib/public-cms/contract.ts`) refuses `/api/`,
`/app/`, `/auth/` and `/_next/` outright, because those are the authenticated
routes and a public payload pointing at one would be a customer's evidence
photograph on a marketing page. That rule is right, and it is why the existing
`GET /api/gallery/images/<id>` can never appear in a public payload however
carefully it checks the row it serves. Managed media needs a path that is public
by its shape.

### Why the original upload has no URL

`ORIGINAL` is the untouched upload: up to 20 MB, possibly HEIC, carrying
whatever the camera wrote — including location. It exists so the library can
re-derive variants, not so it can be fetched by anyone who can guess a URL. It
has no public role in the delivery contract, so there is no path that names it.

## What the route does

`app/assets/media/[itemId]/[variant]/route.ts`:

- parses the request path through the delivery contract, or 404s;
- selects the gallery row **only** when it is `PUBLISHED` **and** `PUBLIC` —
  decided in the query, so a draft, a hidden item, an archived one, an
  `INTERNAL` photograph and a customer's `CUSTOMER_JOB` evidence never match
  rather than being filtered out afterwards;
- never resolves an actor. The response therefore cannot vary by viewer, which
  is what makes `public, max-age=3600, stale-while-revalidate=86400` honest;
- 404s — not 403s — for everything else, so the status does not confirm which
  ids exist;
- never writes or removes an object.

Each of those is asserted in `scripts/test-private-media-contract.mjs` as a
declared public reader, and each has a negative case in
`scripts/test-private-media-contract-negative.mjs` that breaks it and requires
the gate to fail.

The cache lifetime is bounded rather than `immutable`: a variant's bytes never
change for a given identity, but an item can be taken out of `PUBLIC`, and that
has to reach a cache nobody can purge within a knowable window.

## Production gate — the host mapping

**`PUBLIC_MEDIA_HOST_MAPPING = NOT CONFIGURED`.**

The path is host-relative by construction, which is the whole point: it says
nothing about which origin answers it. Two facts decide what still has to be
configured before managed media reaches a visitor.

1. The public website is served from the apex `natheegroup2025.com`; the
   application is on its own origin. A `/assets/media/…` path in a public
   payload is therefore resolved against **the apex**, and the apex must route
   it to the application.
2. `worker/index.ts` sets `Cross-Origin-Resource-Policy: same-origin` on every
   response. So linking the application's hostname directly from the apex would
   not work even if someone tried: the browser would block the image. The
   same-origin path is not a stylistic preference — it is the only shape that
   loads.

Required before managed media is live, and **not done here**:

- the public origin must forward `/assets/media/*` to the application origin,
  preserving the path;
- the existing static `/assets/gallery/*` files must keep being served by the
  apex as they are today. The two prefixes are disjoint, so this is additive.

Until that mapping exists, the resolver and the route are correct and unreachable
from the apex. No hostname or binding was invented to paper over it.

## The renderability rule, and the defect it found

Writing the resolver surfaced a real gap in the existing pipeline.

`components/gallery-bulk-upload-form.tsx` produced **WebP and AVIF only**, and
`lib/public-cms/media.ts` refuses media with no `jpeg` or `png` display variant
— a `<picture>` whose `<img>` fallback is WebP leaves an older client with an
empty box. So a photograph uploaded through the CMS could be published and would
have rendered as nothing. The static release was unaffected because its
`/assets/gallery/*.jpg` files come from `scripts/optimize-public-gallery.mjs`.

Fixed on both sides of the upload:

- the uploader now encodes a JPEG display and thumbnail as well, and it is not
  optional — it is the fallback the renderer requires;
- `app/api/gallery/route.ts` refuses a `PUBLIC` upload with no `jpeg`/`png`
  display variant (`missing_public_fallback`), so the editor learns at upload
  rather than discovering a blank hero on a published page;
- `lib/public-media-store.ts` refuses to resolve an item without one, with the
  reason, so an item that predates this cannot silently render as nothing.

A variant with no measured width or height is dropped rather than given a
guessed pair. `tests/public-media-store.test.mjs` proves each of these against
real rows.

## What is deliberately not served here

The Owner-supplied static manifest (`public-site/assets/gallery.json`) is the
static release's own gallery and is **not** resolvable through this route. Its
items have no D1 row, and its per-item `width`/`height` are the source
dimensions rather than each variant's — 1706×960 recorded against a display
image that is actually 1600×900. Emitting those as intrinsic dimensions would
be publishing a number that was never measured, so managed content references
D1 gallery items only.
