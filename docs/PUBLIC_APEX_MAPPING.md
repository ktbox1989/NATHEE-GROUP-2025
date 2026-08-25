# Apex mapping and sitemap ownership

Two gates that were open, prepared to close together. Nothing here is activated,
and Production is untouched.

Both concern the same fact: the public site is a static document root on Z.com
at `https://natheegroup2025.com`, and the application is a Cloudflare Worker on
its own origin. Two surfaces the application owns have to answer on the apex.

---

## 1. Public media host mapping

### Why a proxy, and not a redirect

`worker/index.ts` sets `Cross-Origin-Resource-Policy: same-origin` on **every**
response. So an `<img>` on an apex page pointing at the application origin is
blocked by the browser — not slower, blocked. A `RewriteRule … [R=302]` cannot
deliver a photograph at all.

The apex therefore has to answer as itself and fetch the bytes behind the
scenes. That is `[P]`, and it is why the delivery contract builds a
*host-relative* path in the first place: `/assets/media/<id>/<role>.<ext>` is
the only shape that loads.

### The routing rule

Written by `scripts/set-public-apex-mapping.mjs` into one managed block in
`public-site/.htaccess`, exactly as the login handoff is:

```apache
<IfModule mod_proxy.c>
<IfModule mod_rewrite.c>
  RewriteEngine On

  RewriteCond %{HTTP_HOST} ^natheegroup2025\.com$ [NC]
  # CMS-managed photographs
  RewriteRule ^assets/media/(.*)$ https://app.natheegroup2025.com/assets/media/$1 [P,QSA,L]
  # the one canonical sitemap
  RewriteRule ^sitemap\.xml$ https://app.natheegroup2025.com/sitemap.xml [P,QSA,L]
</IfModule>
</IfModule>
```

What each part is for:

| Requirement | How it is met |
| --- | --- |
| path | `(.*)` captured and reappended; the application parses the path itself and 404s anything its own contract could not have written |
| query string | `QSA` |
| Host/origin | the browser only ever sees the apex, so CORP `same-origin` is satisfied and no CORS or CORP relaxation is needed |
| `If-None-Match` | forwarded unchanged by `mod_proxy`; nothing in the release strips request headers |
| `ETag` | returned by the application and passed through; the 304 is decided by the application, not by Apache |
| `Content-Type` | from the application; the static `AddType` rules do not apply to a proxied response |
| `Cache-Control` | **from the application.** The static image rule in `.htaccess` would otherwise replace it, so it now carries `"expr=%{REQUEST_URI} !~ m#^/assets/media/#"`. That matters: the application's value is bounded rather than immutable precisely so an item withdrawn from `PUBLIC` stops being served within a knowable window |
| PUBLIC + PUBLISHED only | unchanged and untouched by routing — decided in the application's query, session-blind, 404 for everything else |

Only these two paths are proxied. `/api`, `/app/`, `/auth` and `/login` must
never be, and both the Node suite and the Z.com gate refuse a release where they
are: putting an authenticated surface on the apex would place session cookies in
the scope of a document root that a deploy script overwrites by file copy.
`/assets/gallery/*` stays served by the apex itself — the two prefixes are
disjoint, so this is additive to the static release.

### Why it is still INACTIVE

`PUBLIC_MEDIA_HOST_MAPPING=READY_NOT_ACTIVATED`. Two facts must be proven on the
real host first, and neither can be established from this repository:

1. **`mod_proxy` and `mod_proxy_http` are enabled.** Shared cPanel hosting
   frequently disables both, and a `[P]` rule without them does not proxy — it
   fails, on the apex, for every managed photograph.
   `scripts/probe-zcom-runtime.sh` now reports `ZCOM_MOD_PROXY=AVAILABLE` only
   when a module listing names both. Anything less is `UNKNOWN`, which keeps the
   gate closed rather than guessing.
2. **The application is reachable at the target.** Proxying to a host that is
   not serving replaces a working static site with errors.
   `scripts/verify-app-integration.sh` answers this.

Activation requires both tokens and is one command; rollback is the same command
with `--state inactive`, and `scripts/test-public-apex-mapping.sh` proves it
restores the shipped file byte for byte.

The target is `https://app.natheegroup2025.com`, taken from
`lib/app-origin.ts` — the canonical origin the codebase already refuses to
confuse with the apex. No hostname was invented here, and the DNS/routing
approval for it remains the Owner gate `DEPLOYMENT_ARCHITECTURE.md` describes.

---

## 2. Sitemap ownership

**The application owns `https://natheegroup2025.com/sitemap.xml`.**

A static file cannot own it. Posts are published from the CMS without a deploy,
and a page can be taken out of the index the same way, so a file copied at
release time is stale the moment either happens — and staleness in a sitemap is
invisible: it keeps advertising withdrawn URLs and hides new ones, with nothing
reporting a failure.

`app/sitemap.xml/route.ts` is `force-dynamic`, for the same reason every managed
public page is: a publish is visible on the next request and there is no cache
to invalidate.

### One builder, not two sitemaps

`lib/public-sitemap.ts` is the only place that decides what is listed. The
static release artifact is now **generated from it** by
`scripts/build-public-sitemap.mjs`, and `npm run test:public` fails if the
committed file has drifted. So the file the apex serves today and the document
the application will serve after the mapping is active come from one source and
cannot disagree about what a route is called.

### What is listed

| Rule | Behaviour |
| --- | --- |
| published `INDEX` pages | listed |
| `NOINDEX` pages and posts | **excluded** — listing a page whose own directive says noindex sends a crawler two contradictory instructions |
| hidden pages | excluded; a reader cannot reach them |
| unpublished posts | absent, because the reader never sees them: the query only returns posts whose latest event is a `PUBLISH` |
| `/news/` index | listed only once at least one post is, since an empty index is not worth submitting |
| renamed post | listed once, at the slug it has now. The old URL is a 301 from `/news/[slug]`; a redirect is a hop, not a destination |
| `/gallery/` | always listed — a public route with no CMS revision, so no robots field to consult |
| private/app routes | impossible: every path is checked against the closed public route list before it is emitted |

Canonical URLs are `https://natheegroup2025.com`, from
`lib/public-cms/contract.ts`, whichever origin actually rendered the document.

`changefreq` and `priority` are not emitted. Both are advisory, every major
crawler ignores them, and a number nobody computed is a number nobody can
defend. Dropping them is the only change to the bytes the apex serves today.

### When the database cannot be read

The route does not return an empty sitemap. Submitting one claims the site has
no pages, which is far more damaging than a temporary error, so it falls back to
the eleven marketing routes — which are always live, because their
source-controlled defaults are.

---

## Still open after this

- `PUBLIC_MEDIA_HOST_MAPPING` activation, pending the two proofs above.
- The Sites/DNS decision in `DEPLOYMENT_ARCHITECTURE.md` that gives the
  application a reachable origin at all.
- `AUTHENTICATED_HTTP_E2E`, still blocked with no Supabase environment.
