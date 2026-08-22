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

The home page cannot be unpublished. An unrecognised event neither purges
everything nor silently does nothing: it is reported as needing the guarded
deploy.

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
