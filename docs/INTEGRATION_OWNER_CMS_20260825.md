# Owner CMS integration — A + B, 2026-08-25

Base `main` `e69af731`, Lane A `848d91cb`, Lane B `cb4e2979`, merged in a fresh
worktree in that order with no squash and no history rewritten.

## The one textual conflict

`package.json`, exactly as both lanes predicted. Resolved as a union with an
anchored three-way merge: base order preserved, each side's additions inserted
before the base entry they precede on that side, then asserted to contain every
token from both sides and to reference no file that does not exist.

| Script | base | merged |
| --- | --- | --- |
| `test` | 32 files | 38 |
| `test:unit` | 49 files | 54 |
| `test:db` | 29 files | 35 |
| `test:security` | 21 commands | 23 |

## Three disagreements that were not conflicts

None of these would have failed a merge. All three would have passed each lane's
own CI and been wrong in front of a visitor.

### 1. Two public media strategies

Lane A's `/news` built `/api/gallery/images/<id>` URLs itself, on the reasoning
that the runtime-rendered site and the statically built release are different
delivery targets. Lane B then answered the open ask with the real contract:
`/assets/media/<id>/<role>.<ext>`, public by the shape of its path, plus
`resolvePublicMedia` — the production `PostMediaResolver`, selecting only
`PUBLISHED` + `PUBLIC` rows in the query, building every source through the
delivery contract, and re-checking its own output with Lane A's `validateMedia`.

A's reasoning became obsolete rather than wrong: having one contract was the
point of asking for it, and `validateMediaSrc` refuses `/api/` outright, so a
news payload built the old way could never have satisfied the contract it exists
to satisfy.

`/news` now resolves through `resolvePublicMedia` and renders through
`buildMediaRenderModel` — Lane A's own render model, written before anything
called it. That also picks up what the shared model gives and a hand-rolled
`img` did not: `<picture>` with avif and webp sources, a guaranteed raster
fallback, `srcset`, and a refusal to render rather than a broken image.

`components/public-media-image.tsx` is the single public image element.

### 2. Two tie-breaks for "which publication is live"

Lane B found that `created_at` has one-second resolution by the timestamp
contract, so two publications inside the same second tie, and moved every
publication read onto `rowid` — insertion order, never reused because deletion
is refused by trigger.

Lane A's index SQL still broke that tie on the primary key, which is a random
UUID. Publishing and reverting inside one second would therefore have let the
`/news` index keep listing a post that `/news/<slug>/` already answered 404 for,
decided by which UUID happened to sort higher. Now both use `rowid`, with two
tests that fail under the old ordering.

### 3. A rename nothing read

Lane B built `post_slug_history`, the rename route and `listPostRedirects`.
Nothing consumed them, so a rename still lost its inbound links — the row simply
existed. `/news/[slug]` now resolves a miss through `resolvePostRedirect` and
answers a permanent redirect. Chain resolution and loop refusal stay in the
contract rather than being repeated in the route.

## Lane A asks, classified

| Ask | State |
| --- | --- |
| Posts schema, `publishedAt`/`updatedAt`, categories, post `NOINDEX` | RESOLVED (before this integration) |
| Publication events `POST_PUBLISHED` / `POST_UNPUBLISHED` / `POST_MOVED` | RESOLVED — `lib/publication-events.ts`, wired into every publish route, plan recorded in the audit row |
| Post slug history and rename redirect | RESOLVED — migration `0030`, rename route, and `/news/[slug]` now consumes it |
| Public media delivery URL | **PARTIALLY RESOLVED** — the contract is decided and implemented; the Production host mapping is not, and stays an explicit gate |
| Site settings: address, email, LINE id, LINE QR | STILL OPEN — `SiteSettings` still carries brand, two phones, navigation and footer only |
| Page-level `seo.robots` (published but unlisted) | STILL OPEN — posts have it, managed pages still emit `index:true` unconditionally |
| Page `seo.ogImageItemId` | STILL OPEN — every share card is text-only |
| Gallery batch reorder endpoint | STILL OPEN — no `/api/gallery/order`; ordering is still one item at a time |
| Quotation new/used field | STILL OPEN |
| Portfolio schema | STILL OPEN |
| Sitemap ownership once posts change without a deploy | STILL OPEN (recorded, not yet an ask) |

## Production gates that remain

**`PUBLIC_MEDIA_HOST_MAPPING = NOT CONFIGURED`.** The delivery path is
host-relative by construction. The public site is the apex; the application is a
separate origin; and `worker/index.ts` sets
`Cross-Origin-Resource-Policy: same-origin`, so linking the application hostname
from the apex would be blocked by the browser even if someone tried. Before
managed media reaches a visitor the apex must forward `/assets/media/*` to the
application origin, preserving the path, while continuing to serve the static
`/assets/gallery/*` files itself. The two prefixes are disjoint, so it is
additive. No hostname was invented here.

**Migration `0030` is not applied to Production.** Production remains at
`0000–0029`.

## Findings recorded, not fixed here

1. **Publish-time and render-time media rules differ.** `app/api/posts/[slug]/publish/route.ts`
   verifies references with `resolvePublishReferences` (the item is `PUBLISHED` +
   `PUBLIC`), while `resolvePublicMedia` additionally requires a `jpeg`/`png`
   display variant. A post whose image predates the uploader fix can therefore
   publish and then render without that image. It degrades safely — the image is
   dropped, never broken — but the editor is told at the wrong moment. The fix is
   for the post publish route to verify through `resolvePublicMedia` and report
   `unresolvable` reasons, which it already produces.

2. **`/assets/media/…` answers 500 rather than 404 when the D1 binding is
   absent.** Not a leak, and not a Production state, but it is the one public
   route that does not fail closed the way the rest of the CMS does. A `try` /
   `catch` returning the existing `notFound()` would settle it.

3. **The ten managed marketing pages and the public gallery still render
   `/api/gallery/images/<id>`.** They are server-rendered HTML rather than
   contract-validated payloads, so nothing is violated today, and both predate
   either lane. Moving them onto the delivery contract is the last step to a
   single mechanism everywhere, and it is deliberately not taken inside a merge:
   it depends on every already-published item having a `jpeg`/`png` display
   variant, which the uploader only started guaranteeing in this cycle, so the
   visible failure mode is a marketing page losing its hero. It belongs with the
   host-mapping decision and an Owner-visible check of existing items.
