# What Lane A needs from Lane B

Everything the public site can build without a CMS runtime is built. What is
left is genuinely blocked, and this is the list — stated as fields rather than
as intentions, so each one can be answered or refused rather than discussed.

Nothing here is urgent in the sense of blocking Production: the public site
serves the static release today and every default in `lib/public-cms/` is chosen
to keep it that way. These are what stand between that and an Owner editing the
site without a deployment.

Measured against `main` at `8da1053`. Lane A work is on
`lane-a/public-product-hardening-20260823`; the earlier
`lane-a/public-cms-hardening-20260823` is already merged into `main`.

---

## 1. Posts have no schema at all

`lib/public-cms/posts.ts` is a complete consumer contract with no sender. The
routes are unbuilt because there is nothing to build them from, and an empty
news section is honest where a fabricated one is not.

To map, a post needs:

| Field | Why the public site needs it |
| --- | --- |
| `slug` | the URL. Must be latin, lowercase, hyphen-separated — a Thai slug is unreadable when shared and fragile in a sitemap, and transliterating a brand name is a guess |
| `status` | only `PUBLISHED` renders; a draft must have no representation |
| `publishedAt` | the article date, and the sitemap's `lastmod` |
| `updatedAt`, nullable | **must be null when never edited.** Defaulting it to `publishedAt` tells a search engine the post was edited when it was not |
| `title` | the single `h1` |
| `excerpt` | distinct from the body. The index shows it; without one a card is a headline with nothing under it |
| `category` id **and** label | the label is rendered, so a bare id is not enough |
| `featuredImage` reference | resolvable to alt text and real dimensions, like a page's `imageItemId` |
| `body` sections | the same shape as page sections; the heading rules are already shared |
| `seo.title`, `seo.description` | per post |
| `seo.robots` | see finding 3 below — this matters more for posts than for pages |
| `revisionId` | preview binding and cache validation |
| **slug history** | so a rename becomes a 301 rather than a dead link. Without it, renaming a post throws away every inbound link to it |

## 2. Publish events for posts

`planInvalidation` already handles `POST_PUBLISHED`, `POST_UNPUBLISHED` and
`POST_MOVED`. Lane B needs to emit them, carrying the post path — and
`POST_MOVED` needs both the old and the new path, because dropping only one
leaves half the site serving the state from before the rename.

## 3. `NOINDEX` is not expressible

Every managed page in `CmsPageContent` is indexable, so the mapper emits
`robots: "INDEX"` for all ten. That is correct today: they are all public
marketing pages.

It stops being correct the moment a page needs to be published but unlisted — a
seasonal landing page, a page linked only from a quotation — and it is more
likely still for posts, where "published but not in search" is an ordinary
editorial choice. The mapper must not guess, so this needs a field on Lane B's
side.

## 4. `publishedAt` is not in the page payload

`getPublishedSitePage` returns status, content and revision, but not the time of
the publication event. The mapper requires it as an argument rather than
defaulting to "now", which would make every page look freshly published to
anything reading the timestamp — including the sitemap.

## 5. The quotation form needs a home on the application origin

`POST /api/quotation` calls `isSameOrigin` first and answers a cross-origin
request with a bare `403` before parsing anything. A form served from the public
apex and posting to `app.natheegroup2025.com` would fail every time.

So the online quotation form has to be served from the application origin. That
is a deployment decision rather than a form detail, and it is recorded in
`lib/public-forms/quotation-contract.ts` where the form gets wired up.

## 6. New/used has nowhere to go

There is no column for vehicle condition in `quote_requests` and no field for it
in `parseQuotationForm`; an unknown form field is discarded without comment. The
public form therefore does not ask, because a question whose answer is thrown
away is worse than an absent one.

Collecting it needs a column and a parser field. Until then the customer can
state it in `notes`, and `UNMAPPABLE_QUOTATION_FIELDS` records the omission as a
tested decision rather than an oversight.

## 7. A gallery visibility that is added later

`GALLERY_VISIBILITY_IS_PUBLIC` writes out every visibility and whether the
public site may render it, rather than testing `!== PUBLIC`. A value Lane A has
never heard of is refused.

That means adding a fourth visibility on Lane B's side will make published
photographs disappear from the public gallery until this map is updated. That is
the intended failure direction — a new visibility silently defaulting to
*visible* is how customer evidence ends up on a marketing page — but it is worth
knowing before it happens rather than after.

A test asserts every visibility `lib/gallery.ts` defines has an entry, so the
suite fails rather than the site.

---

## 8. Four block types have no section type

The public renderer implements twelve blocks. Lane B's seven section types map
onto seven of them. The rest are recorded in `BLOCKS_LANE_B_CANNOT_EXPRESS`
rather than invented:

| Block | What Lane B would need |
| --- | --- |
| `STATS` | a figure with a **required** provenance string; an unsourced number must not be publishable |
| `VIDEO` | a media file, a poster reference and an optional `.vtt` captions track |
| `RELATED_SERVICES` | a list of links; `FEATURES` carries cards with prose instead |
| `FEATURED_WORK` | the portfolio schema below |

`IMAGE` is deliberately absent too: a `CONTENT` section carrying an image maps
to `TEXT`, which renders the copy and the photograph together, and a standalone
captioned image has no section type of its own.

## 9. External video would need a CSP change, not a content field

The public `Content-Security-Policy` declares `default-src 'self'` and states
neither `frame-src` nor `media-src`, so both fall back to it. An embedded
YouTube or Vimeo player is blocked and renders as an empty box.

Self-hosted `.mp4` and `.webm` under `/assets/` work today and are what the
`VIDEO` block accepts. Allowing an embed is a security decision about the policy
— it would mean trusting a third-party origin to run in a frame on the marketing
site — and it is not Lane A's to make alone.

## 10. The portfolio has no schema

`lib/public-cms/portfolio.ts` is a complete consumer contract with no sender.
It needs slug, publication state, title, summary, categories drawn from the
gallery's own ids, a featured image, a gallery, a body of blocks, related
service links, per-entry SEO and a revision id — and, as for posts, slug history
so a rename becomes a 301.

**The hard requirement:** whatever produces a portfolio entry must not copy a
job row into it. The consumer refuses any payload carrying `vin`,
`registration`, `jobNumber`, `contactPhone`, `storageKey`, `podId` or any of the
other names in `FORBIDDEN_PAYLOAD_KEYS`, at any depth. That is a backstop, not a
licence: the mapper on Lane B's side should be selecting fields, not spreading a
row and letting this catch it.

## 11. Section types are a shared contract now

Adding a `CmsSectionType` will make every page containing it fall back to the
static release, because the block mapper refuses a section type it has never
seen rather than rendering an unreviewed shape. That is the right failure
direction, but it is a coordinated change: Lane A needs the new type mapped
before Lane B ships content using it. A test compares the two lists so the
suite fails rather than the site.

## Already reconciled, no action needed

These were mismatches. They are fixed on Lane A's side against Lane B's code as
it stands, and the drift is now held by gates rather than by attention.

- **The quotation request key.** The server requires `quote-<uuid v4>`; the
  frontend emitted 32 bare hex characters, so every submission would have been
  refused as `error=invalid`. Fixed, with `scripts/test-quotation-wire-contract.mjs`
  comparing both sides field by field.
- **The quotation response.** Success is a `303` to
  `/quotation?submitted=QT-YYYY-NNNNNN`, not a JSON acknowledgement. The
  frontend now reads the redirect and requires a real business number.
- **The quotation bounds.** `origin`, `destination` and `notes` were looser on
  the client than on the server, which truncates rather than rejecting — silent
  data loss. `quantity` was tighter, refusing at 500 what the server accepts to
  10,000. All now mirror the server exactly.
- **The gallery ordering tie-break.** Two items with the same order number
  sorted differently on each render.

## What Lane A will do when each arrives

1. **Posts schema** → write the mapper, exactly as `map-from-cms.ts` does for
   pages. No changes to `posts.ts` should be needed; if they are, that is a
   finding worth discussing rather than patching around.
2. **`NOINDEX` field** → one line in the mapper, and the head model already
   handles both cases.
3. **Publish events** → already handled; only the emitter is missing.
4. **New/used** → add the field to the draft, the wire format and the gate.

Until then the boundary stays closed: `resolveContentSource()` defaults to
`STATIC`, reaching `CMS` needs `PUBLIC_CMS_SOURCE=CMS` **and** a matching
`PUBLIC_CMS_CONTRACT_VERSION`, and a typo in either keeps the static release.
