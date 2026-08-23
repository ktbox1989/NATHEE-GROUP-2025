# Public CMS integration

What the public website requires of the CMS, stated from the consumer side, and
what has to happen before any of it switches on.

Lane B owns the CMS schema, storage, write APIs and admin UI. Nothing in
`lib/public-cms/` touches those, and nothing in it guesses their column names.
This is the receiving end of the contract.

**Status: inactive.** Production serves the static release, and none of this is
wired into a rendered route.

## The boundary

`resolveContentSource()` defaults to `STATIC`. Reaching `CMS` needs two things
at once:

```bash
PUBLIC_CMS_SOURCE=CMS
PUBLIC_CMS_CONTRACT_VERSION=1     # must equal PUBLIC_CMS_CONTRACT_VERSION
```

A typo, a stale value or a version mismatch keeps the static release. While the
boundary is inactive the CMS loader is never called at all, so a half-built
endpoint cannot affect the live site.

Bump `PUBLIC_CMS_CONTRACT_VERSION` in `lib/public-cms/contract.ts` only for a
breaking change to what the public site consumes. That bump is the mechanism
that stops an older CMS from feeding a newer site.

## What Lane B needs to publish

The one thing blocking migration is the canonical CMS schema and API contract.
When it exists, the work on this side is a mapping function into `PublicPage`,
not a redesign.

For each public page the adapter needs to obtain:

| Consumer field | Meaning |
| --- | --- |
| `slug`, `path` | one of the 11 known public routes |
| `status` | must be `PUBLISHED`; drafts have no representation |
| `heading` | the single `h1` |
| `seo.title`, `seo.description` | unique per page |
| `seo.canonicalPath` | must equal the page's own path |
| `seo.robots` | `INDEX` or `NOINDEX` |
| `sections[].headingLevel` | `2` or `3`, stated not inferred |
| `sections[].body` | paragraphs as plain strings |
| `sections[].media` | see below |
| `revisionId`, `publishedAt` | cache validation and invalidation |

For each image:

| Consumer field | Meaning |
| --- | --- |
| `altText` | required, non-empty |
| `caption` | `null` or non-empty |
| `variants[].src` | same-origin path under `/assets/` |
| `variants[].width/height` | positive integers, the real stored size |
| `variants[].format` | `jpeg`, `webp`, `avif` or `png` |
| `variants[].role` | `thumbnail` or `display` |

A payload that fails any of this is refused **whole** and the static release is
used. Partial rendering is never attempted.

## What the contract refuses, and why

- **Anything but `PUBLISHED`.** Draft, hidden, scheduled and archived have no
  representation in the type, so a draft cannot leak by construction.
- **Media outside `/assets/`.** Absolute and protocol-relative URLs,
  `javascript:` and `data:` URLs, traversal, and every authenticated route
  (`/api/`, `/app/`, `/auth/`, `/_next/`). This is the rule that keeps private
  customer and job evidence off the public site, and it is enforced twice:
  on arrival and again in the render model.
- **Missing alt text or dimensions.** Both are gates the live site already
  meets; a CMS must not be able to lower that bar.
- **A canonical pointing away from its own page**, which silently hands the
  page's ranking to another URL.
- **A skipped heading level**, so the data cannot reproduce the `h1 -> h3`
  defect already fixed on `/services/`.
- **A CMS outage.** A throw, a null, or a page for the wrong route all fall
  back to static with a reason.

## Preview

Preview is the only place unpublished content renders at a public origin, so it
is treated as a leak risk.

- HMAC-signed tokens, verified in timing-safe fashion.
- Bound to **one page and one revision**, so a shared link cannot be replayed
  against another page or a later draft.
- At most 15 minutes. A preview link gets pasted into chat and email; a
  long-lived one is a permanent unauthenticated window onto drafts.
- A weak or absent secret fails closed.
- Responses are `noindex, nofollow, noarchive` and `private, no-store`.
- Never in the sitemap, and the canonical always points at the published URL so
  a leaked link cannot compete in search.
- Verification failures return a generic reason; the visitor is never told
  which part failed, or the token becomes an oracle.

Lane B owns who may *request* a preview. This side owns what it will accept.

## Publish without deploying

The promise to editors is that ordinary content and media edits go live with no
SSH, no Git and no public deploy. Publishing emits an event; `planInvalidation`
turns it into the exact set of paths to drop.

| Event | Invalidates | Notes |
| --- | --- | --- |
| `PAGE_PUBLISHED` | that page | sitemap regenerated |
| `PAGE_UNPUBLISHED` | that page, sitemap | URL must stop returning 200 |
| `MEDIA_PUBLISHED` / `MEDIA_WITHDRAWN` | pages using it, `/gallery/`, `/` | the home page carries a gallery preview |
| `SETTINGS_PUBLISHED` | every public route, `robots.txt` | brand, nav, phones and footer are on every page |

| `POST_PUBLISHED` | that post, `/news/` | sitemap regenerated |
| `POST_UNPUBLISHED` | that post, `/news/`, sitemap | URL must stop returning 200 |
| `POST_MOVED` | both URLs, `/news/`, sitemap | the old URL keeps answering, with a 301 |

Publishing a post fans out to the post and the index and no further. Nothing
else shows posts, and invalidating the eleven marketing routes on every
editorial edit would dump most of the cache for a change none of them display.

A rename invalidates **both** URLs. Dropping only one leaves half the site
serving the state from before the rename. The old URL is not in `removedPaths`:
it has to keep answering, with a 301, because that is what carries the inbound
links to the new slug — removing it throws them away.

The home page cannot be unpublished.

`delivery` states how a change reaches visitors, as a field rather than a phrase
to match on:

- **`CACHE`** — the promise the CMS makes to editors: content and media go live
  with no deployment.
- **`DEPLOY`** — the change is in the release itself (templates, styles,
  scripts, the manifest) and needs the guarded Z.com deploy. An unrecognised
  event lands here: it neither purges everything nor silently does nothing.
- **`REJECTED`** — the event was malformed: a post path that is not one, a
  rename to itself, unpublishing the home page. That is neither of the others.
  A deployment would not fix it, and reporting success would tell an editor
  their change is live when no cache was touched.

## One sitemap, one robots.txt

Pages and posts are validated separately, but a site has exactly one sitemap.
`buildSitemap` merges both, keeps only what is published and indexable,
deduplicates, and sorts — sorting so the generated file can be reviewed as a
diff rather than merely observed.

A page reports when it was published. A post reports its edit date if it has
one and its publication date otherwise, and `/news/` reports the newest post's
date, because that is what actually changed when it appeared. A site with no
posts has no news section in its sitemap at all.

`buildRobotsTxt` keeps crawlers out of `/api/`, `/app/`, `/auth/`, `/login/` and
the login status page. That is a courtesy to the crawler, not a boundary —
`robots.txt` protects nothing and authentication is the real control — but it
stops a crawl budget being spent on URLs that only answer with a redirect. A
test asserts the generated contract still matches the `robots.txt` currently
shipped, because one of the two is what crawlers actually get.

A non-canonical origin disallows everything, including its sitemap. A staging
copy indexed alongside production splits the site's ranking between two hosts,
and the wrong one wins about half the time.

Changes to templates, styles, scripts or the manifest still require the Z.com
deployment. Saying so plainly stops an editor waiting for a change that was
never going to appear.

## SEO once content is editable

Static SEO comes from the build and cannot drift. Editable SEO can, in ways
that quietly cost the site its search presence, so each case is decided:

- unpublished is a **hard 404**, never a 200 with empty content;
- a `NOINDEX` page is served but kept out of the sitemap;
- a renamed slug returns **301** — permanent is right here, unlike the login
  handoff, because a rename is durable and must transfer inbound links;
- the sitemap lists only published, indexable pages, deduplicated;
- a redirect may not point off-site, traverse, loop, or lead away from a live
  public route.

Redirect chains are impossible by construction: a valid redirect must point AT
a public route and may never point AWAY from one, so no valid redirect's target
can be another's source. `redirectChainIsImpossible` states that invariant.

## Current content, ready to migrate

`node scripts/inventory-public-content.mjs` reads the built release, maps every
route onto the contract and validates the result. It migrates nothing, and it
runs in the test suite so content that could no longer satisfy the contract
fails a test rather than a migration.

Current inventory, all 11 routes mapping cleanly:

| | Count |
| --- | --- |
| Public routes | 11 |
| Sections | 70 |
| Paragraphs | 159 |
| Page images | 32 |
| Gallery items | 9, all with alt text and dimensions |
| Gallery categories | 10 |

The machine-readable form is `docs/public-content-inventory.json`, regenerated
with `--write`.

## Reconciliation against Lane B's schema

Lane B's published payload (`CmsPageContent` in `lib/site-cms-content.ts`) was
compared field by field with this contract. It is close enough to map, and
`lib/public-cms/map-from-cms.ts` does so. Five differences are real and are
recorded here rather than smoothed over.

| Consumer field | Lane B provides | Handling |
| --- | --- | --- |
| `slug`, `path` | `SITE_PAGE_DEFINITIONS`, without a trailing slash | normalised (`/services` → `/services/`) |
| `status` | `PublishedSitePageState` — `PUBLISHED`, `HIDDEN`, `UNMANAGED`, `BROKEN` | only `PUBLISHED` maps; the rest refuse |
| `seo.title` / `description` | yes | direct |
| `seo.canonicalPath` | **absent** | derived as the page's own path; any other value would be wrong |
| `seo.robots` | **absent** | see finding 2 |
| `heading` (h1) | **no page-level field** | derived from the enabled `HERO` section; see finding 1 |
| `sections[].headingLevel` | **absent** — B stores a section `type` | derived; see finding 1 |
| `sections[].body` | single string | wrapped into one paragraph |
| `sections[].media` | `imageItemId`, a reference | resolved through an injected resolver; see finding 3 |
| media `altText`, dimensions | on the gallery item, not the page | supplied by the resolver, refused if absent |
| `revisionId` | yes | direct |
| `publishedAt` | **not returned** | supplied by the caller; see finding 4 |

### Finding 1 — heading rank is derived, not stored

B stores `type` (`HERO`, `CONTENT`, `FEATURES`, `FAQ`, `CTA`, `CONTACT`), which
describes what a section *is*, not what rank it renders at. Rank is a rendering
decision this lane already owns, so the mapper applies one fixed rule: the
enabled `HERO` heading becomes the page `h1`, every other enabled section is
`h2`, and a section's feature `items` are `h3`.

That is exactly the shape the current static pages already have, which the
content inventory verified across all eleven routes. The validator is unchanged
and still rejects a skipped level, so a future section type that broke the
outline would fail rather than ship.

A page with no enabled `HERO` heading is **refused**. Inventing an `h1` would
put words on a customer-facing page that nobody wrote.

### Finding 2 — `NOINDEX` is not expressible

Every managed page in B's model is indexable. The mapper therefore emits
`robots: "INDEX"` for all of them. Today that is correct, because all ten
managed pages are public marketing pages.

If a page ever needs to be published but not indexed, B's payload has no way to
say so, and the mapper must not guess. That would need a field on B's side.

### Finding 3 — media is a reference, and resolution is Lane B's data

`imageItemId` points at a gallery item; the alt text, dimensions and variants
live there. The mapper takes an injected resolver rather than reaching into the
gallery itself, which keeps it pure and testable and keeps the data boundary
where it belongs.

A reference that cannot be resolved is **dropped and the section still renders
its text** — a missing image is not a reason to lose the copy. A resolved item
without alt text or real dimensions is refused outright, and a resolver that
returned an authenticated path is still rejected by the contract, which the
tests prove.

Note that the gallery stores absolute URLs and this contract requires
same-origin paths, so the origin is stripped during mapping.

### Finding 4 — `publishedAt` is not in the payload

`getPublishedSitePage` returns status, content and revision, but not the time of
the publication event. The mapper requires it as an argument rather than
defaulting to "now", which would make every page look freshly published to
anything reading the timestamp.

### Finding 5 — `/gallery/` is not a managed page

B manages ten text pages. This contract knows eleven public routes, because
`/gallery/` exists on the public site as a media collection rather than authored
copy. It is out of scope for page mapping and stays served from the gallery,
which is the correct split — it simply means the two route lists are not the
same length, and neither is wrong.

## Migration order, when the schema exists

1. Lane B publishes the canonical schema and API contract.
2. Write the mapping from that payload into `PublicPage`. No changes to the
   contract or the validators should be needed; if they are, that is a finding
   worth discussing rather than patching around.
3. Import the inventory above as the initial content, gallery first since it is
   already a clean collection with alt text and variants.
4. Verify with the CMS boundary enabled in a non-production environment only.
5. Run the live audit against that environment; it must report `problems=0`.
6. Only then consider enabling the boundary for Production, as a separate
   reviewed decision with its own rollback.

Until step 6, Production keeps serving the static release, which is the
behaviour every default in this module is chosen to preserve.

## Recovery, when the CMS is not there

Every way a CMS fails is decided here rather than discovered in production, and
each one falls back to the static release with a reason.

| Failure | Behaviour |
| --- | --- |
| loader throws, sync or async | static, reason carries the error |
| response is not JSON | static — a proxy error page is a parse failure, not a page |
| `null` / `undefined` | static, "CMS returned no page" |
| schema drift | static, with the violations reported rather than swallowed |
| newer contract version | static — refused whole, never partially rendered |
| unpublished, hidden, scheduled, archived | static — a draft has no representation |
| page delivered for the wrong route | static — otherwise the About copy silently serves at `/services/` |
| private media path anywhere in the payload | static — this one is a refusal, not a degradation |
| **no answer at all** | static after `CMS_LOAD_TIMEOUT_MS` |

### The slow case is the dangerous one

A CMS that is *down* was already survivable: a rejected promise falls back
immediately. A CMS that is *slow* was not. `resolvePage` awaited the loader with
no deadline, so a load that never settled held the request open until something
upstream gave up — and what the visitor eventually saw was a gateway error page,
not the static release. The one failure the fallback exists to prevent was the
one it did not cover.

`loadWithDeadline` bounds the wait and never rejects. It attaches a no-op catch
to the abandoned promise before racing: without that, a load that times out and
rejects a moment later becomes an unhandled rejection, which on a worker runtime
can take down the whole isolate — the outage this is all meant to survive.

### Posts have nothing to fall back to

`resolvePost` applies the identical rules, but a post has no static release
behind it. A refusal there means the URL is a 404, not that something else
renders. The caller must treat `STATIC` as "this post is not available" —
showing a stale or partial article would be worse than showing none.

## Site settings, and the one fallback that is a value

The chrome — brand, navigation, telephone numbers, footer — appears on every
page, which makes it the one piece of CMS content whose failure is total. A page
body that fails to load falls back to the static release and the visitor never
knows. Chrome that fails leaves the site with no way to get anywhere, on every
URL at once.

So `buildSiteChrome` is the only consumer here with a **value** fallback rather
than a source fallback. Unusable settings render the shipped defaults and say
why, rather than rendering an empty header. Three conditions trigger it: no
usable navigation link, no dialable telephone number, or no brand name. Each one
would leave a visitor stranded on whatever page they landed on.

A navigation item is re-checked on this side even though Lane B's parser already
blocks the authenticated prefixes. A link into `/app/` sends a customer from the
marketing site to a login screen and reads as broken; an off-site link in the
header is how a single compromised settings row becomes a phishing redirect on
every page at once. An item that fails is dropped and **reported** — a
silently shorter menu is how this kind of thing goes unnoticed.

Telephone numbers are published with the separators stripped from the `tel:`
href and kept in the display text. Some handsets dial a `tel:` containing dashes
incorrectly, which on a phone-first site is the difference between a call and a
customer giving up.

The current page carries `aria-current="page"`, so it is announced rather than
only coloured.

## The block renderer

`lib/public-cms/blocks.ts` is the vocabulary the public site renders. It exists
because `PublicSection` — a heading with paragraphs and media under it — is not
enough to reproduce the site that already exists.

### The measurement that prompted it

`mapCmsPageToPublicPage` read **seven of the fourteen** fields on Lane B's
`CmsSection`. What it discarded:

| Field | What it is |
| --- | --- |
| `eyebrow` | the small label above every page heading |
| `primaryLabel` / `primaryHref` | the "ขอใบเสนอราคา" button |
| `secondaryLabel` / `secondaryHref` | the second call to action |
| `galleryCategorySlug` | which photographs a gallery block shows |
| `galleryLimit` | how many |

`type` was read only to find the `HERO`; after that a FAQ, a card grid and a
gallery all became a generic `h2` with paragraphs under it. A page published
through the CMS would therefore have rendered **worse than the static page it
replaced**: no quotation button, no FAQ accordion, no service card grid.

`CmsSectionInput` now mirrors Lane B's section in full. Declaring only the
fields one mapper happened to read is how the other seven came to be dropped
without anyone noticing — a field that is not in the type cannot be missed.

### The twelve blocks

`HERO`, `TEXT`, `IMAGE`, `GALLERY`, `SERVICE_CARDS`, `CTA`, `FAQ`, `CONTACT`,
`STATS`, `VIDEO`, `RELATED_SERVICES`, `FEATURED_WORK`.

Every one validates before it renders and is refused whole if it fails. A
refused block is not a degraded block: the page falls back to the static release
rather than rendering a hero with no heading or a card grid with an empty card
in it. An **unknown** block type is refused rather than skipped, because
skipping silently drops content an editor believes they published.

Three rules are worth stating on their own.

**A link must lead somewhere the site actually serves.** Same-origin, and a
live public route or a post. Off-site is how one edited row becomes a redirect
on a marketing page; a link into `/app/` reads to a customer as a broken site.
A link that fails is dropped during mapping rather than rendered.

**A figure cannot be published without saying where it came from.** `STATS`
requires a `source` on every entry. The site already refuses to state
unconfirmed capacity numbers — "เว็บไซต์ไม่แสดงตัวเลขที่ยังไม่ยืนยัน" is on the
dealer-fleet page — and a stats block is exactly the shape that invites an
unverified number onto the site. Making provenance a required field turns that
rule from something a person has to remember into a property of the data.

**Video is self-hosted only, and the CSP decided that.** The public policy
declares `default-src 'self'` and states neither `frame-src` nor `media-src`, so
both fall back to it. An embedded YouTube or Vimeo player is blocked by the
browser and renders as an empty box; an external `<video src>` never loads.
Accepting an embed URL would let an editor publish a video that cannot play and
find out from a customer. Allowing one is a decision about the CSP, not about
content, so it is refused here and recorded as a contract ask.

### The outline

Exactly one `HERO`, and it must be first. Both rules are checked across the set
rather than per block, because neither defect is visible from inside one: two
heroes are each valid alone, and so is an `h3` that happens to follow an `h1`.

### What Lane B cannot express

`BLOCKS_LANE_B_CANNOT_EXPRESS` records the five block types no section type
produces — `STATS`, `VIDEO`, `RELATED_SERVICES`, `FEATURED_WORK` and `IMAGE` —
with the reason for each. A test asserts every block type is either mapped from
a section or recorded here, because a block the renderer supports, nothing maps
to, and nobody wrote down is a feature that quietly never arrives. That test
caught `IMAGE` while it was being written.

A second test holds `CMS_SECTION_BLOCK_TYPES` against Lane B's own
`CmsSectionType` union. An unrecognised section type makes the whole page fall
back to static — the right failure direction, but it must be caught by a test
rather than by a customer looking at a page that reverted to the static copy.

## Portfolio

`lib/public-cms/portfolio.ts` serves `/work/` and `/work/<slug>/`.

It is the highest-risk content type on the site, and not for any reason to do
with rendering. A portfolio entry is derived from a real job, and that job
carries the customer's company name and telephone number, the vehicle's VIN and
registration, the driver, the inspection and the proof of delivery.

So it refuses twice. `PublicWorkItem` has no field for any of it, **and** the
validator walks the payload refusing any object carrying a key named after one
of those columns, at any depth.

The second rule is the one that matters. The realistic failure is not somebody
adding a `customerName` field to the type — it is `{ ...jobRow, title, summary }`
in a mapper, which satisfies the type perfectly and ships the entire row. A type
cannot see that; the key scan can. A test holds `FORBIDDEN_PAYLOAD_KEYS` against
`db/schema.ts` so the list stays real column names rather than drifting into
invented ones that catch nothing.

The scan is bounded in depth and breadth and **reports** when it hits the bound
rather than returning clean: "too deep to check" is not the same as "checked and
clean".

Categories are the gallery manifest's ids rather than a second taxonomy, so a
photograph and the case study it belongs to filter the same way. Ordering has
four keys — featured, the Owner's order, newest, then slug — because a portfolio
is curated and whatever the Owner has not ordered by hand still has to fall in a
stable sequence instead of shuffling between requests.

## The CMS transport

`fetchCmsJson` in `source.ts` is the loader `resolvePage` and `resolvePost`
were always given by the caller. While it was the caller's, every transport
failure was somebody else's problem.

| Failure | Behaviour |
| --- | --- |
| 5xx or 4xx | refused; the status is in the reason |
| `text/html` where JSON was expected | refused before the parser sees it |
| no content type | refused |
| **declared length ≠ received length** | refused as truncated |
| over `CMS_MAX_PAYLOAD_BYTES` | refused before parsing |
| malformed JSON | refused |
| no answer | bounded by the same deadline |

Truncation is the one that could not be caught anywhere else. A response cut off
mid-array can still parse as valid JSON if the cut lands on a boundary, and what
arrives is a page that is **structurally correct and missing half its content**.
Nothing downstream can distinguish that from a page an editor deliberately
shortened. The declared content length is the only evidence, and it is only
available here. The comparison is in bytes rather than characters, because Thai
is three bytes a character and a character count would report every page as
truncated.

The request carries `credentials: "omit"` and `cache: "no-store"`. A public
marketing page has no business sending a visitor's cookies to the CMS, and a
cached CMS response is the stale-content bug this whole module exists to
prevent.

## Posts and news

`lib/public-cms/posts.ts` is the consumer contract for editorial content. Lane B
has no posts schema today, so this is the receiving end of a contract that does
not yet have a sender — written now so that when the schema arrives the work is
a mapping function rather than a design argument.

**Status: inactive.** No route renders it, and no static page links to it.

### Why it is not just another page

The eleven marketing routes are a closed list, and a CMS page for anything else
is refused. Posts are the opposite shape: the whole point is that an editor
creates URLs nobody enumerated in advance. So the safety comes from the slug
rules and the published state instead of from an allowlist.

Everything a post renders that a page also renders **is** the page's code.
Sections, media and the heading outline all come from `contract.ts`, through
`validateSections`, which pages and posts now share. The single-`h1`,
no-skipped-level rule is a property of the public site rather than of a content
type, and a second copy of it would be a second chance to get one wrong.

### Slugs

`/news/` is the index; a post is `/news/<slug>/`.

Slugs are lowercase latin words joined by single hyphens, at most 80 characters.
A Thai title left to itself produces a Thai slug, and a percent-encoded Thai
slug is unreadable in a shared link and fragile in a sitemap — so the CMS must
supply a latin slug and anything else is refused rather than transliterated,
because transliteration is a guess about a brand name.

`page`, `feed`, `rss`, `atom`, `sitemap`, `index`, `all`, `category` and `tag`
are reserved: a post at `/news/page/2/` is unreachable however carefully it is
rendered. A post can never take a marketing route, and the path must be exactly
the one derived from the slug — a disagreement between them means one is wrong
with no way to tell which.

### The list

Newest first, with the slug as the tie-break. The tie-break is not cosmetic:
posts published in one batch share a timestamp, and without a deterministic
order the list reshuffles between requests, so pagination shows one post twice
and hides another.

A page past the end, a page number that is not a positive integer, or a category
with no posts is a **refusal**, not an empty list at 200. An empty list served
as 200 is a soft 404: it keeps the URL indexed and tells the visitor the site is
broken rather than that they mistyped. An empty site still has a first page.

### Redirects

Post redirects differ from page redirects in one way that matters. A marketing
route can never be a redirect source, which makes chains impossible by
construction. A post's rename target **can** itself be renamed later, so chains
are real here and are resolved rather than assumed away — up to four hops, after
which the table is treated as broken and the visitor gets a 404 rather than a
redirect loop in their browser. A cycle back to the starting path resolves to
nothing for the same reason.

A redirect may not point at a marketing route, off-site, at the index, or at
itself.

### SEO

`buildPostHead` and `buildPageHead` in `seo.ts` produce the same `HeadModel`,
because the parts that differ between a post and a page are the schema type, the
article dates and the breadcrumb depth, and nothing else.

| | Page | Post |
| --- | --- | --- |
| `og:type` | `website` | `article` |
| schema | route's own type, `Service` naming its provider | `BlogPosting` |
| breadcrumb | หน้าแรก → page | หน้าแรก → ข่าวสาร → post |
| dates | — | `datePublished`, and `dateModified` only if edited |

`PUBLIC_ROUTE_SCHEMA_TYPES` mirrors what the static release already emits, so
moving a route onto the CMS does not silently change how a search engine is told
to read it. There is exactly one `Organization` node, referenced by `@id` from
the `Service` provider and from a post's author and publisher, rather than
repeated — two Organization records would compete.

A post that has never been edited publishes **no** `dateModified`. Defaulting it
to the publication date would tell a search engine the post was edited when it
was not.

The unfurl image is the display variant in JPEG or PNG. AVIF and WebP are
skipped deliberately: several chat clients cannot decode them and show no image
at all rather than falling back. With no usable photograph the brand logo is
used, never nothing.

### Preview emits no social tags

A preview response carries **no** Open Graph or Twitter tags at all, and no
structured data.

`noindex` is read by crawlers. It is not read by LINE, by email clients, or by
any of the other places a preview link actually gets pasted — those unfurl the
URL and render a card. Without this rule, sharing a preview link with one
colleague would render the unpublished copy to everyone in the conversation,
which is the leak the preview boundary exists to prevent. The canonical still
points at the published URL so a leaked link cannot compete in search.

### Sitemap

Published and indexable only, deduplicated and sorted, with `/news/` listed
above the posts — but only when there is at least one, because advertising an
empty section of the site is worse than omitting it. An unpublished post is
absent because it has no `PublicPost` to be listed: it cannot be forgotten.

### Lane B gate

Posts need a schema on Lane B's side before any of this can be mapped:

- post identity, slug and publication state;
- publication and modification timestamps as separate fields;
- an excerpt distinct from the body, since the list needs one;
- a category reference with a label;
- a featured image reference resolvable to alt text and real dimensions;
- per-post SEO title, description and an indexable flag — the same
  `NOINDEX`-is-not-expressible finding as for pages applies here, and matters
  more, because a post is far more likely to be published but deliberately
  unlisted; and
- the slug history, so a rename can become a 301 rather than a dead link.

Until that exists, `validatePublicPost` has no sender and the routes stay
unbuilt. That is the correct state: an empty news section is honest, and a fake
one is not.

## Quotation form

Lane B owns the endpoint, database and anti-abuse verification.
`lib/public-forms/quotation-contract.ts` owns what the browser sends and when it
may claim success.

Success requires a complete acknowledgement whose request key matches the
submission. A bare 200, an HTML page, an empty body, `ok:true` with no
reference, or an acknowledgement for a different request are all failures. A
customer told their enquiry was received when it was not will simply wait.

One cryptographically random key per enquiry is reused across retries, so a
network failure followed by a retry cannot create a second request. The
verified telephone numbers stay offered whenever the form cannot be used.

Client validation is a courtesy to the person typing, not a security boundary.
