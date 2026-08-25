# What Lane A needs from Lane B — 2026-08-25

Measured on `main` at `e69af731ea43d2ac885080558f3c42d2bd951dcf`, from
`lane-a/owner-cms-public-20260825`. This is the delta since
`docs/LANE_A_CONTRACT_ASKS.md`; that file still describes everything else, and
nothing in it is withdrawn.

Each ask below is stated as fields and behaviour rather than as an intention, so
it can be answered or refused. Where Lane A could have guessed, it did not: a
guess that satisfies a validator and fails in front of a visitor is worse than
an absent feature, and every one of these has that shape.

---

## Closed by this lane, no action needed

**The public `/news/` routes exist.** `POSTS_INDEX_PATH` had named a route since
the consumer contract was written and nothing served it, so an Owner could
publish a post and no reader could reach it. `app/news/page.tsx` and
`app/news/[slug]/page.tsx` now serve it, reading through `getPublishedPost` and
one new bounded index query. No change was needed to Lane B's schema, store or
mapper — the contract worked as designed.

**Runtime media delivery is decided for the runtime site, and only for it.**
Ask 2 of the previous document asked where CMS media is served from. For pages
rendered by this application the answer was already in the tree and in
production use: `/api/gallery/images/:id`, which serves a `PUBLISHED` + `PUBLIC`
item to anyone, refuses everything else, and is what every managed marketing
page has always used. `/news/` uses the same route rather than inventing a
second mechanism.

**The `/assets/` question is still open, and still Lane B's and the Owner's.**
`lib/public-cms/contract.ts` requires `PublicMedia.variants[].src` to start with
`/assets/` and explicitly refuses `/api/`, because that contract describes the
statically built release served from a document root. So `PostMediaResolver`
still has no production implementation and still should not get one until it is
decided where CMS-managed media lives under `/assets/` at deploy time. Nothing
in this lane forces that decision.

---

## 1. Site settings cannot hold the company's own contact details

`SiteSettings` carries brand name, legal name, abbreviation, tagline, logo, two
telephone numbers, navigation and two footer strings. That is everything the
shared header and footer need and less than the Owner is expected to be able to
edit.

The address on `/contact`, the company email and the LINE QR code are all in
source or in the static release's asset folder today
(`public-site/assets/contact/line-qr-owner-supplied.png`), which means changing
a phone number is a CMS edit and changing an address is a deployment.

| Field | Shape | Why |
| --- | --- | --- |
| `contact.email` | bounded string, validated as an address, may be empty | The footer and `siteOrganizationSchema` both want it; there is nowhere to put it |
| `contact.addressLines` | array of bounded strings, at most 4 | An address is not one line, and joining it with commas reads wrong in Thai |
| `contact.lineId` | bounded string, may be empty | Rendered as text beside the QR; a QR with no readable id is unusable on desktop |
| `contact.lineQrItemId` | gallery item id, may be empty | **Resolve it exactly like `brand.logoItemId`** — a published, public gallery item. No new media mechanism, and publish already refuses a settings revision whose media cannot be served |

`collectSettingsReferences` already returns `brand.logoItemId` for that check and
would need `contact.lineQrItemId` added beside it, or a published settings
revision could point at an archived QR.

Deliberately **not** asked for: a map URL. The settings validator refuses every
external and protocol-relative href, and relaxing that to admit one Google Maps
link would relax it for everything. If the Owner wants a map link it is a
separate, narrow field with its own allowlist, and it is a security decision
rather than a content one.

## 2. A managed page cannot be published but unlisted, and has no share image

`CmsPageContent.seo` is `{ title, description }`. Two consequences:

**`robots` is hardcoded.** `getManagedPageMetadata` emits
`robots: { index: true, follow: true }` for all ten routes. That is correct for
ten marketing pages and stops being correct the first time one needs to be
published and unlisted — a seasonal landing page, or a page linked only from a
quotation. Posts already have this: `POST_ROBOTS = ["INDEX", "NOINDEX"]`, and
`/news/[slug]` honours it. Pages need the same field, and the mapper and the
head model already handle both cases.

**Every share card is text-only.** `openGraph` carries title, description, url
and site name, and no image, because there is no field to take one from. The
shape that costs nothing new: `seo.ogImageItemId`, a gallery item id resolved
the same way a section's `imageItemId` already is, and added to
`collectPageReferences` so publish refuses a revision whose share image a reader
could not be served.

Both are one field each on a JSON payload that is already versioned, and both
are additive: an absent field means today's behaviour.

## 3. The gallery has no way to express a reorder

`POST /api/gallery/[id]` with `action=UPDATE` writes one item and replaces every
field on it. A reorder is not a statement about one item; it is a statement
about a sequence, and it cannot be expressed one item at a time here:

- The public order is `sort_order ASC, created_at DESC, id DESC`.
- Every item defaults to `sort_order = 0`, so in the ordinary case every item is
  tied and the tie is broken by upload time.
- Moving an item up therefore needs an integer strictly between two neighbours,
  and between two zeroes there is none. A "move up" button would do nothing,
  which is worse than no button.

What would express it:

```
POST /api/gallery/order
  requestKey: gallery-order-<uuid v4>     idempotent, same rule as the others
  categoryId: <id>                        one category at a time
  orderedIds: <id>[]                      bounded, at most one admin page
```

writing sequential `sort_order` (10, 20, 30 … so later insertions have room) in
one audited batch, requiring `gallery:write`, refusing any id that is not in
that category, and recording one audit row for the reorder rather than one per
item.

Until it exists, `/app/gallery/order` shows the true public sequence — which no
screen did before, so the position field could be edited and its effect could
not be seen — and edits one position at a time through the existing audited
update, saying plainly what happens when two items share a number. That is
honest but it is not a reorder.

## 4. Renaming a post now breaks real links

Restated from the previous document because the consequence changed. Slug
history and the `POST_MOVED` / `POST_PUBLISHED` / `POST_UNPUBLISHED` events were
already asked for, and while nothing served `/news/` a rename cost nothing.

Now `/news/<slug>/` is a real URL that can be shared, linked and indexed.
`uq_posts_slug` is a unique index on `posts.slug` with no history table, so a
rename overwrites in place: the old URL 404s and every inbound link to it is
lost, silently, at the moment of saving.

Lane A is still built for the other side: `resolvePostRedirect` resolves rename
chains and `planInvalidation` handles `POST_MOVED` by invalidating both paths
while leaving the old one answering 301. Both still need a stored previous slug.

The editor currently refuses to change a slug at all — `slugField` is rendered
only when creating — which is the right temporary answer. It is a limitation to
remove when there is history, not a design.

## 5. A note on where the sitemap will have to live

Not an ask yet, recorded so it is not discovered late.

`buildPostSitemapUrls` exists and lists the index plus every published,
`INDEX` post. Nothing calls it, because the sitemap that is served today is
`public-site/sitemap.xml`, a static file listing the eleven marketing routes and
built by the static release. Posts are in D1 and change without a deploy, so the
two cannot both be right for long.

Deciding that means deciding which origin serves the canonical sitemap, which is
the same deployment question as ask 2 of the previous document, and it should be
answered once for both rather than twice.

---

## What Lane A does when each arrives

1. **Contact fields** → render them in the footer, `/contact` and
   `siteOrganizationSchema`; add `contact.lineQrItemId` to the settings editor's
   media picker, which already exists for the logo.
2. **Page `robots`** → one line in `getManagedPageMetadata`, plus a select in the
   page editor exactly like the post editor's.
3. **`ogImageItemId`** → one field in the page editor and one branch in the
   metadata builder.
4. **Reorder endpoint** → replace the per-row position field on
   `/app/gallery/order` with move controls and a single save.
5. **Slug history** → enable slug editing in the post editor and surface the
   redirect chain in the revision history, so a rename is visible as a decision
   rather than as a URL that quietly changed.

---

# Follow-up, same day — after the A+B integration

Measured on `integration/owner-cms-20260825`. The UI/consumer side of items 1-3
was taken as far as the existing write contracts allow. What is left needs
`parseSiteSettings` / `parseCmsPageContent` widened, which is a write-contract
change rather than a UI one, so it is stated here field by field instead of
being built behind a form that would silently drop what the Owner typed.

**No migration is involved in any of it.** `site_settings_revisions.settings_json`
and `site_page_revisions.content_json` are JSON blobs with a `json_valid` check
and a length bound. Every field below is additive: absent means empty, and every
revision already stored keeps parsing unchanged.

## 1. Site settings still cannot hold the company's contact details

Unchanged and still blocking. `SiteSettings.contact` is `{ primaryPhone,
secondaryPhone }`.

```ts
contact: {
  primaryPhone: string;      // exists
  secondaryPhone: string;    // exists
  email: string;             // bounded 160, validated as an address, may be empty
  addressLines: string[];    // at most 4, each bounded 120, may be empty
  lineId: string;            // bounded 60, may be empty
  lineQrItemId: string;      // gallery item id, may be empty
}
```

`lineQrItemId` needs **no new media mechanism**: resolve it exactly as
`brand.logoItemId` is resolved today, and add it to `collectSettingsReferences`
in `lib/site-cms-publish.ts` beside the logo, or a published settings revision
can point at an archived QR and the contact page loses it silently.

Two things found while trying to close this in the UI, both of which change how
the fields should be presented:

**There is no Owner-confirmed address or LINE ID anywhere in the repository, and
that is deliberate.** `public-site/contact/index.html` says so in the page text:
it shows neither, because the repo has no verified street address or coordinates
and does not guess a LINE ID or use a sample account. So all four fields must
start empty, nothing may be pre-filled, and the editor should say plainly that an
empty field means the public page shows nothing rather than a placeholder.

**The app-rendered `/contact` is currently less complete than the static release
it will replace.** The static page shows the checksum-verified QR at
`/assets/contact/line-qr-owner-supplied.png` — `PRODUCTION_OWNER_MEDIA_PASS`
gates it — and the app's `/contact` renders CMS sections only, which have no
field that can carry it. Until `lineQrItemId` exists, cutting the apex over to
the application loses the QR from the contact page. That makes this ask a
release blocker for the cutover rather than a nice-to-have.

## 2. A managed page still cannot be published-but-unlisted

Still open, and unchanged:

```ts
seo: {
  title: string;             // exists
  description: string;       // exists
  robots: "INDEX" | "NOINDEX";   // POST_ROBOTS already exists for posts
}
```

`getManagedPageMetadata` emits `index: true` for all ten routes with no way to
say otherwise. Posts already have this field and `/news/[slug]` honours it.

**The OG image half of this ask is now closed and needs nothing from Lane B.**
Rather than leave every share card text-only while waiting for a field, the card
image is derived from the page's own content: the hero image, or the first
enabled section carrying one, resolved through the delivery contract so it is
the same `/assets/media/…` path the page renders and can only ever be a
PUBLISHED + PUBLIC item. The jpeg display variant specifically, because several
crawlers decode neither webp nor avif.

An explicit `seo.ogImageItemId` override is still worth having — for a share
image that should differ from the hero — but it is no longer blocking anything,
so it drops below `robots` in priority.

## 3. Gallery reorder is now real, and still not atomic

`/app/gallery/order` is a genuine reorder: move up and down, then one save that
renumbers the visible sequence in tens through the existing audited item update.
Renumbering also removes the equal-`sort_order` ties that made the previous
screen unable to express a move at all.

What it cannot do is what only a batch endpoint can:

- it writes **N sequential requests**, one per moved row, not one;
- it is **not atomic** — a failure part-way leaves the earlier rows moved. The
  screen reports exactly how many were written and reloads the true order from
  the database rather than showing the order the browser was holding;
- it produces **one audit row per item**, where a reorder is one decision.

So the ask narrows from "there is no way to reorder" to "a reorder cannot be one
transaction or one audit record":

```
POST /api/gallery/order
  requestKey: gallery-order-<uuid v4>
  categoryId: <id>
  orderedIds: <id>[]          bounded to one admin page
```

writing sequential `sort_order` in one batch, requiring `gallery:write`,
refusing any id outside that category, and recording one audit row for the move.


---

# Answered by Lane B, same day — `lane-b/owner-cms-contract-closure-20260825`

From `integration/owner-cms-20260825` at `5d66c33d`. Local only. The full
contract, field by field and with the error codes, is in
`docs/LANE_B_WRITE_CONTRACTS_20260825.md`; this is the index.

| Ask | State |
| --- | --- |
| §1 `contact.email` / `addressLines` / `lineId` / `lineQrItemId` | **CLOSED** — exactly those field names, all defaulting to empty, `lineQrItemId` in `collectSettingsReferences` |
| §2 page `seo.robots` | **CLOSED** — wired through the metadata builder, the mapper, `resolveSeoResponse` and the sitemap |
| §2 `seo.ogImageItemId` | **NOT ADDED**, deliberately — see below |
| §3 batch reorder endpoint | **CLOSED** — `POST /api/gallery/order`, one transaction, one audit row |
| §4 slug editing in the post editor | still open, Lane A's side |
| §5 who serves the canonical sitemap | still open, and still a deployment decision |

**No migration.** All three were already expressible, and that was measured
rather than assumed: the largest page document is 3,082 bytes against a 50,000
bound, the settings document is 587 against 20,000, and `sort_order` is an
existing indexed integer column. `drizzle/` is untouched.

**Nothing invented.** The seed was regenerated and diffed structurally: 14 keys
added, 0 existing values changed or removed. No address, email or LINE id is
pre-filled, because there is none to pre-fill.

**`ogImageItemId` was not added on purpose.** This document says the OG half is
closed by the hero-derived card and is "no longer blocking anything", and the
brief for this run says not to add a field just because it was an earlier ask.
There is no case today where the share image must differ from the page's own
hero, so there is nothing to prove the need with. When one appears it is one
field and one branch, the same shape as `lineQrItemId`.

**Atomicity was verified, not assumed.** Against the real D1 implementation: a
batch of three position writes followed by a failing insert left all three rows
unchanged. `GALLERY_REORDER_ATOMICITY=IMPLEMENTED`.

**One thing your reorder board must change beyond the endpoint swap.** The
endpoint requires the *complete* set of published public items in one category
and refuses a partial order, because renumbering a subset to 10, 20, 30 leaves
every unnamed item at `sort_order = 0` and therefore in front of everything the
Owner just arranged. Save per category rather than from the "ทุกหมวด" view; the
reasoning and the exact error codes are in the contract document.
