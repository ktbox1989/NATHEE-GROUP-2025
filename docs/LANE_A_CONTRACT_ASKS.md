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

> **Later asks live in `docs/LANE_A_ASKS_20260825.md`**, measured on `main` at
> `e69af73`. Two items below moved there: the public media host is now decided
> for the runtime-rendered site and still open for the static release, and the
> posts routes it blocked are built. Nothing here is withdrawn.

---

## Reconciliation, 2026-08-23 — measured in a combined tree

Lane A `3e75d7a` + `production-readiness` `967401f` merged onto `main` `8da1053`
in an isolated worktree and run end to end. **Fully green**, and the six open
asks were confirmed by executing Lane B's mapper against Lane A's validator
rather than by reading either.

| Ask | Verified how | Result |
| --- | --- | --- |
| posts schema | `mapStoredPostToPublicPost` → `validatePublicPost` | ACCEPTED |
| `publishedAt` / `updatedAt` | unedited post | `updatedAt === null`, no `article:modified_time` emitted |
| | edited post | `updatedAt` set, `article:modified_time` emitted |
| categories | id and label survive the map | `{ id, label }` |
| `NOINDEX` | `POST_ROBOTS = ["INDEX","NOINDEX"]` | `robots: noindex, nofollow` |
| robots policy | NOINDEX post's sitemap entry | `includeInSitemap: false`, URLs `[]` |
| public post mapping | canonical and path | derived from slug, canonical equals own path |

Lane B re-exports Lane A's slug validator rather than writing a second one, so
there is one slug rule rather than two that agree today.

### Two gaps remain, and neither is guessed

> **Superseded 2026-08-25.** Both are closed; see the section below. Kept because
> it is the measurement the work was done against.

**1. Slug history / rename redirect policy — no mechanism exists.**

Measured on `967401f`: zero migrations define a slug-history or redirect table,
and `uq_posts_slug` is a unique index on `posts.slug`. A rename therefore
overwrites in place with no record of the previous slug, so the old URL 404s and
every inbound link to it is lost.

Lane A is already built for the other side of this and is waiting:
`resolvePostRedirect` resolves rename chains, and `planInvalidation` handles
`POST_MOVED` by invalidating both URLs while deliberately leaving the old one
answering with a 301. Neither can do anything without a stored previous slug.

Lane B also emits no publication event yet — zero references to
`POST_PUBLISHED`, `POST_UNPUBLISHED` or `POST_MOVED` outside Lane A's own
planner — so a publish currently reaches no cache invalidation at all.

**2. Public media delivery URL and host — undecided.**

`PostMediaResolver` is a type with **no production implementation**: nothing in
`app/` or `lib/` outside its own declaration resolves a gallery item id to a
URL, and the post routes never pass a resolver. Lane B's tests supply fixture
paths under `/assets/media/`.

The open question is not the shape but the host. Lane A's contract requires a
same-origin path under `/assets/`, and the static release serves
`/assets/gallery/…` from Z.com by file copy. Where CMS-managed media is served
from once the CMS is live — the same document root, an R2-backed route, or
something else — decides whether that prefix can still hold, and it is a
deployment decision rather than a schema one.

Until it is decided, no resolver should be written: one that guessed a host
would produce URLs that pass the contract and 404 for visitors.

---

## Answered by Lane B on 2026-08-25 — both remaining gaps are closed

Branch `lane-b/owner-cms-backend-20260825`, from `main` at `e69af73`. Nothing
was applied to Production and nothing was merged.

### 1. Slug history — built, and it needed a migration

The gap was measured six ways before anything was written: zero migrations
define a slug-history or redirect table, zero schema tables, `uq_posts_slug` is
still unique, **no route changes a post slug at all**, nothing supplies
`resolvePostRedirect`, and there were zero `POST_MOVED` emitters outside your
planner. There was nowhere to record a previous slug, so this is the one place a
new migration was genuinely required rather than convenient.

`0030_post_slug_history` — additive, one table, no data touched:

| What | Why |
| --- | --- |
| `post_slug_history(post_id, from_slug, to_slug, ...)` | the previous URL and where it went |
| append-only triggers | a redirect that can be edited can be re-pointed after the links are made |
| `to_slug` must be the post's **current** slug | forces the rename to happen before the record of it, so a row claiming a move that did not occur cannot exist |
| `from_slug` must belong to **no live post** | a redirect can never shadow a URL that answers with real content |
| `from_slug` index is **not** unique | a slug can be abandoned, reclaimed and abandoned again; recency decides, so an Owner can always rename again |

`POST /api/posts/[slug]/rename` performs it. It requires `site:publish`, not
`site:write`: a rename changes which URLs the public site answers, which is a
publication decision rather than an edit.

`listPostRedirects()` in `lib/post-slug-history.ts` is what feeds
`resolvePostRedirect`. It excludes any previous slug that is a live post again —
which happens honestly, when a post is renamed back or a new post takes the
freed slug — and resolves a slug abandoned twice to the most recent move.

Chains work end to end: `tests/publication-events.test.ts` runs Lane B's rename
events through **your** `resolvePostRedirect` with nothing mocked on either
side, and `a -> b -> c` resolves in 2 hops.

### 2. Publication events — emitted

`planInvalidation` had **zero production callers**. It has them now.
`lib/publication-events.ts` maps what was published to a `PublishEvent`, asks
your contract for the plan, and the four write routes record the plan in the
audit row for that publication:

| Route | Event |
| --- | --- |
| `POST /api/site-content/[slug]/publish` | `PAGE_PUBLISHED` / `PAGE_UNPUBLISHED` |
| `POST /api/posts/[slug]/publish` | `POST_PUBLISHED` / `POST_UNPUBLISHED` |
| `POST /api/posts/[slug]/rename` | `POST_MOVED`, carrying both paths |
| `POST /api/site-settings/publish` | `SETTINGS_PUBLISHED` |

A `REJECTED` plan now **refuses the publication** rather than being recorded as
a success — hiding the home page is stopped by your contract, not only by a
string comparison in the route.

What this does not yet do is purge a CDN, because which cache sits in front of
the public site is a deployment fact. The plan is computed and stored on every
publication, so when that binding exists it is a consumer of an existing record
rather than a new mechanism.

### 3. `PostMediaResolver` — implemented, with the host decided as a path

`lib/public-media-store.ts` is the production resolver. Sources are
`/assets/media/<itemId>/<role>.<ext>`, which satisfies your `/assets/` rule, and
the full contract is in `docs/PUBLIC_MEDIA_DELIVERY.md`.

The host is **not** invented. The path is host-relative, and the Production gate
is stated rather than assumed: the apex must forward `/assets/media/*` to the
application origin. It cannot be a cross-origin link instead, because the worker
sets `Cross-Origin-Resource-Policy: same-origin` and a browser would block the
image.

Two things you should know:

- **A defect this found.** The gallery uploader stored WebP and AVIF only, so
  managed media had no `jpeg`/`png` fallback and your `buildMediaRenderModel`
  would have refused every CMS-uploaded photograph. Fixed at the uploader, at
  the upload route, and fail-closed in the resolver.
- **The static manifest is not resolvable through it.** Its items have no D1 row
  and its `width`/`height` are the source dimensions, not each variant's, so
  emitting them as intrinsic dimensions would be publishing an unmeasured
  number. Managed content references D1 gallery items only.

### Still not answered

Asks 5, 6, 7 and 10 are untouched by this run: the quotation form's origin, the
new/used column, the fourth gallery visibility, and the portfolio schema.

---

## Answered by Lane B on 2026-08-23

Read-only inspection of `origin/production-readiness` at `967401f`, which is
**not yet merged into `main`**.

Lane B has shipped the posts schema — migration `0026_public_posts`,
`lib/post-cms-content.ts`, `lib/post-cms-store.ts` and `lib/post-cms-public.ts`
— and it answers asks 1 and 3 for posts, field for field:

| Ask | How it was answered |
| --- | --- |
| posts schema | `PostContent` with slug, title, excerpt, category, featured image and sections |
| `updatedAt` null until edited | taken from publication events: the first PUBLISH is `publishedAt`, a later one sets `updatedAt` |
| excerpt distinct from body | `excerpt`, bounded separately and required |
| category id **and** label | `PostCategory = { id, label }` |
| `NOINDEX` expressible | `POST_ROBOTS = ["INDEX", "NOINDEX"]` |

`mapStoredPostToPublicPost` calls Lane A's `validatePublicPost` on its own
output rather than trusting it, and derives `canonicalPath` from the slug rather
than storing it. That is the contract working the way it was meant to: one
validator, owned by the consumer, run by the producer.

Still outstanding for posts: **slug history**, so a rename becomes a 301 rather
than a dead link, and the `POST_PUBLISHED` / `POST_UNPUBLISHED` / `POST_MOVED`
events (ask 2) — `planInvalidation` handles all three already; only the emitter
is missing.

Posts map to `PublicSection[]`, not to blocks, which is the right split: a news
article is prose, where a marketing page and a case study are composed.

**One merge note.** `package.json` is the only file both lanes touch, and it
will conflict again. The resolution is a union that drops nothing — Lane B's
post tests and acceptance gates, Lane A's block, portfolio and public-CMS tests.

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
