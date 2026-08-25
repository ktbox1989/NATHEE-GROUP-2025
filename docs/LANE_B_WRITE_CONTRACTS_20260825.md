# Write contracts closed for Lane A — 2026-08-25

Branch `lane-b/owner-cms-contract-closure-20260825`, from
`integration/owner-cms-20260825` at `5d66c33d`. Local only. Production
untouched, `/login` still `INACTIVE`, migration `0030` still unapplied.

Answers `docs/LANE_A_ASKS_20260825.md` §1, §2 and §3. Everything Lane A already
shipped — the reorder screen, the hero-derived share image, the `/news` media
contract, the public-media negative gates — is untouched.

**No migration.** `site_settings_revisions.settings_json` and
`site_page_revisions.content_json` are JSON documents with a `json_valid` check
and a length bound; `gallery_items.sort_order` is a `NOT NULL` integer with a
`>= 0` check already covered by `idx_gallery_items_public_order`. Measured, not
assumed: the largest page document is 3,082 bytes against a 50,000 bound and
the settings document is 587 against 20,000. Migrations stay at `0000`–`0030`.

---

## 1. `SiteSettings.contact` — the four fields, as asked

```ts
contact: {
  primaryPhone: string;      // unchanged
  secondaryPhone: string;    // unchanged
  email: string;             // bounded 160, validated, may be empty
  addressLines: string[];    // at most 4, each bounded 120, may be empty
  lineId: string;            // bounded 60, may be empty
  lineQrItemId: string;      // gallery item id, may be empty
}
```

Field names are exactly the ones the ask specified. **No `mapUrl`** — the ask
refused it and the reason still holds.

- **Everything defaults to empty.** The regenerated seed was diffed
  structurally: 14 keys added, **0 existing values changed or removed**. There
  is no Owner-confirmed address, email or LINE id in this repository, and
  `public-site/contact/index.html` says so in its own copy rather than showing a
  sample. Your editor copy should say that an empty field means the public page
  shows nothing.
- **Old revisions still parse.** Absent means empty, so every settings revision
  already stored keeps working and keeps meaning what it meant.
- **Your current editor already round-trips them** without knowing they exist,
  because it spreads the settings object it was handed. Adding the inputs is
  additive and nothing is lost in between. There is a test for exactly that.
- `collectSettingsReferences` now returns `contact.lineQrItemId` beside
  `brand.logoItemId`, so publish refuses a settings revision whose QR cannot be
  served — the failure the ask named.

### Rendering the QR — use this, do not build a URL

```ts
import { resolveSettingsMedia } from "@/lib/site-settings-media";

const { logo, lineQr, unresolvable } = await resolveSettingsMedia(getDb(), settings);
// lineQr: PublicMedia | null — feed it to buildMediaRenderModel()
```

It resolves through the one delivery contract, which decides three things at
once: only a `PUBLISHED` + `PUBLIC` row resolves at all (a draft, hidden,
archived, `INTERNAL` or `CUSTOMER_JOB` item comes back as `null`); every source
is a `/assets/media/<id>/<role>.<ext>` path, so no storage key leaves the server
and nothing points at the authenticated gallery route; and a jpeg or png display
variant is required, so the QR is decodable by every client.

`null` means render nothing. An unreadable QR is worse than an absent one — a
visitor will try to scan it.

`unresolvable` is non-empty only when an item was withdrawn *after* publication;
surface it to the Owner rather than swallowing it.

## 2. `CmsPageContent.seo.robots`

```ts
seo: {
  title: string;             // unchanged
  description: string;       // unchanged
  robots: "INDEX" | "NOINDEX";
}
```

`CMS_ROBOTS` is exported from `lib/site-cms-content.ts`, and `POST_ROBOTS` is
now that same array rather than a second copy that agrees today.

Wired end to end, so the field is not decorative:

| Consumer | Behaviour |
| --- | --- |
| `getManagedPageMetadata` | `INDEX` → `index/follow`; `NOINDEX` → `noindex/nofollow` |
| `mapCmsPageToPublicPage` | carries the page's own value instead of asserting `INDEX` |
| `resolveSeoResponse` | already emitted `"noindex, nofollow"`; it now has something to read |
| `buildSitemapUrls` | already filtered on `includeInSitemap`; an unlisted page drops out |
| Preview | unchanged and unchangeable — `noindex, nofollow, noarchive` regardless of the page setting |

Absent means `INDEX`, so every stored revision behaves exactly as before. A
value that is neither is **refused**, not defaulted: a typo must not publish a
page the Owner asked to keep out of search. Surrounding whitespace is trimmed,
as it is for every other field.

Your side is the select in the page editor, exactly like the post editor's.

**One rule added that you did not ask for, so it is called out:** the home page
cannot be published `NOINDEX` (`error=home_cannot_be_noindex`). De-indexing the
one URL every other page links to is not a content decision, for the same reason
hiding it is not — and the route already refused `HIDE` on `home`. Every other
page may be published unlisted. If the Owner ever wants this, it is one line.

### OG image — deliberately not added

`seo.ogImageItemId` is **not** in this contract. The ask says the OG half is
closed by the hero-derived card and "no longer blocking anything", and the
brief for this run says not to add it just because it was an earlier ask. There
is no case today where the share image must differ from the page's own hero, so
there is nothing to prove a need with. When one appears, it is one field, one
line in `collectPageReferences`, and one branch in the metadata builder — the
same shape as `lineQrItemId`.

## 3. `POST /api/gallery/order`

Atomicity is **not** blocked by the platform. Verified against the real D1
implementation rather than assumed: a batch of three position writes followed by
a failing insert left all three rows unchanged
(`D1_ERROR: UNIQUE constraint failed`, `D1_BATCH_ATOMIC=YES`). The whole
renumber and its audit row go in one `db.batch`.

```
POST /api/gallery/order            (form-encoded, same-origin)
  requestKey:  gallery-order-<uuid v4>
  categoryId:  <gallery category id>
  orderedIds:  <id>            repeated, or one whitespace/comma separated field
  returnTo:    /app/gallery/order?category=…      optional
```

- **`gallery:write`.** Same capability the item update needs.
- **Everything is validated before anything is written**: the request key shape,
  the category exists, every id exists, belongs to that category, and is
  `PUBLISHED` + `PUBLIC`. Duplicates and unknown ids are refused by name.
- **One audit row** for the move, `action=REORDER`, `entityType=gallery_order`,
  `entityId=<categoryId>`, carrying the before and after sequence.
- **Idempotent**: the audit row's id is derived from the request key, so a
  replay collides on the primary key, the batch rolls back, and the response is
  `status=already_ordered`. `audit_logs` is append-only by trigger, so that
  constraint cannot be edited away.
- Positions are `10, 20, 30 …`, so a later single insertion has room.
- An order that changes nothing succeeds without writing.

**One requirement your board does not meet yet.** `orderedIds` must be the
**complete** set of `PUBLISHED` + `PUBLIC` items in that category, and a partial
order is refused with `error=incomplete_order` (the detail is how many the
category has). This is not fussiness: renumbering a subset to 10, 20, 30 leaves
every unnamed item at its old number — usually `0` — which puts all of them in
*front* of the ones the Owner just arranged. Refusing is the only outcome that
is not silently wrong.

So the board needs one change beyond swapping the endpoint: **save per
category**, not from the "ทุกหมวด" view. Concretely:

- when a category filter is active and `items.length < PAGE_SIZE`, the board is
  already holding the complete set — send it;
- from "ทุกหมวด", either disable saving or ask the Owner to pick a category
  first;
- a category with more than 200 public items is refused outright
  (`error=category_too_large`) rather than ordered in part. Nothing is near that
  today.

Error codes, all as `?error=` on `/app/gallery/order`:
`forbidden`, `invalid_request_key`, `invalid_category`,
`invalid_order_empty`, `invalid_order_too_many`, `invalid_order_invalid_id`,
`invalid_order_duplicate_id`, `unknown_item`, `wrong_category`, `not_public`,
`incomplete_order`, `category_too_large`, `gallery_order`.

Success redirects to `returnTo` (bounded to a same-origin `/app/gallery…` path)
with `status=reordered` or `status=already_ordered`, so the Owner still reads
the order back from the database rather than from what the browser was holding.

---

## What is still open

Unchanged from the asks document: slug editing in the post editor (§4 — the
history and the redirect exist, the editor still refuses to change a slug), and
who serves the canonical sitemap once posts change without a deploy (§5).

The `/assets/media/*` Production host mapping is still `NOT CONFIGURED`; see
`docs/PUBLIC_MEDIA_DELIVERY.md`. It gates the QR reaching a visitor exactly as
it gates every other CMS-managed photograph.
