# Site Content CMS

## Purpose and boundary

The Site Content CMS lets an authorized OWNER or STAFF member manage all ten textual public pages without editing source files: Home, Services, motorcycle transport, international transport, storage, Container loading, Dealer/Fleet, Quotation, About and Contact. It is structured content, not a raw-HTML editor: the server accepts only allowlisted section types and bounded fields, React escapes all text, and links are limited to local paths, page anchors and telephone links.

The separate Site Settings screen is the single source for shared brand/legal name, abbreviation, tagline, optional published Gallery logo, verified telephone numbers, bounded public navigation, Login label and Footer. It includes a responsive Header/Footer preview but still requires an explicit save followed by publish.

The current Z.com static site is unaffected. This CMS requires the full Vinext runtime, D1, private R2 and real Supabase Auth. It must not be represented as live until those Production gates pass.

## Permissions

- `site:read`: open the page list, revision history and preview.
- `site:write`: save a new immutable revision.
- `site:publish`: publish a selected revision, republish an older revision as rollback, or hide a non-home page.
- OWNER receives business permissions through the existing OWNER policy.
- Other internal roles are fail-closed and require explicit permission rows.
- CUSTOMER roles receive no Site Content administration permission.

All write and publication APIs require an authenticated actor, same-origin POST, allowlisted page slug and permission check. Every accepted revision/publication writes an Audit Log in the same D1 batch. Request keys make retries idempotent.

## Revision and publication model

- `site_pages` stores the stable identity for an allowlisted page.
- `site_page_revisions` stores canonical versioned JSON and a SHA-256 content hash. Revisions cannot be updated or deleted.
- `site_page_publication_events` is an append-only `PUBLISH`/`HIDE` ledger.
- `site_settings_revisions` stores canonical global settings JSON and its SHA-256 hash. It is append-only.
- `site_settings_publication_events` selects the active settings revision through an append-only ledger; rollback publishes an older revision.
- Rollback never rewrites history; it appends a new publication event pointing at an older revision.
- A database trigger prevents publishing a revision from another page.
- The Home page cannot be hidden, avoiding an accidental blank root route.
- When the CMS tables are unavailable or no revision has been published, the accepted source-controlled Home remains active. Other managed routes use bounded source defaults.
- When global settings are unavailable or malformed, all public pages use verified source defaults. A configured logo renders only while its Gallery record is `PUBLIC` + `PUBLISHED`; otherwise the safe abbreviation is used.
- Public navigation has at most eight unique links, must retain Home and rejects external, protocol-relative, `/api`, `/app` and `/auth` paths.

## Supported sections

- Hero
- Content
- Features
- Gallery rail
- Call to action
- Contact details

There are at most 20 sections per page, 12 repeated items per section, and 24 Gallery images per embedded Gallery. The editor can reorder and disable sections. It cannot insert scripts, styles, iframes or arbitrary external URLs.

Hero/content imagery is chosen only from real `PUBLISHED` + `PUBLIC` Gallery records. Gallery sections query only public published media and fail safely to an honest empty state if the Gallery runtime is unavailable.

## Large Gallery workflow

The Media Library accepts a bounded batch of up to 20 images, each up to 20 MB. The browser processes and uploads one image at a time, creates display/thumbnail WebP and optional AVIF variants, and requires a factual title plus Alt text for every image. Successfully uploaded images remain Draft if a later file fails or the operator cancels the current upload. Retrying skips completed files.

The existing server independently verifies signatures, types, sizes and checksums before committing metadata. Upload never publishes automatically. Publishing, hiding, featuring, categorizing and ordering continue through the audited Gallery permission boundary.

## Delivery contract

What happens between an editor pressing Publish and a reader seeing the change,
and what deliberately does not.

**Draft → Preview → Publish.** Saving writes a revision and changes nothing
public. Preview renders that exact revision through the same component the
public site uses, behind authentication, requiring `site:read`, marked with an
"ยังไม่เผยแพร่" banner, and scoped so one page cannot preview another page's
revision. Publishing appends an event naming the revision; the live page is
whatever the most recent event says.

**Rollback is another publish, never an edit.** Revisions are immutable and
publication events cannot be deleted, so restoring an earlier version means
publishing that revision again. The history therefore records what was live and
when, including the rollback itself.

**The public site resolves content per request.** Every public page that renders
managed content declares `force-dynamic`. There is no cache to invalidate: a
publish is visible on the next request. This matters more than it sounds — a
cached public page would let an editor publish, be told it succeeded, and have
the live site keep serving the previous revision with nothing reporting a
failure.

**Nothing outside the protected tree reads a revision.** Public pages resolve
content only through the published-state helpers, so a draft has no path to an
anonymous reader. Preview is the single deliberate exception and lives behind
authentication under a `index:false, follow:false` directive.

**Publishing verifies the media it is about to show**, refusing a revision whose
images or gallery categories a reader could not be served. See
`docs/AUTH_SETUP.md` for the equivalent Auth contracts.

**The home page can never be hidden.** `trg_site_home_cannot_hide` refuses a HIDE
event for it at the database level, so the public site always has an entry point
no matter what is published elsewhere.

**Scheduling is not supported.** There is no future-dated publish and no expiry.
A publication event takes effect when it is written. Anything that reads as
scheduling would need a runtime that wakes up without a request, which this
deployment does not have, so it is absent rather than approximated.

`scripts/test-cms-delivery-contract.mjs` enforces all of the above, and its
negative test proves the gate rejects twelve specific ways the contract can be
broken — including a public page that stops being per-request and a preview that
stops being private.

## Where the Owner works

`/app/website` is the entry point and the only screen that answers "what is the
public being served right now" without opening four editors. It reports every
managed route with its current state, post counts split by what a reader can
reach, the Media Library split into public, featured, waiting and not-public,
and whether shared settings have ever been published. Four bounded queries, each
returning a single row of counts or one row per managed page.

Two of its states are worth stating precisely, because reporting them loosely
would mislead the person responsible for the site:

- **A page with no publication event is serving its source-controlled default**,
  which passed the release gates. That is a real state and is named as one, not
  shown as missing or as a problem to fix.
- **A database that cannot be read says so.** It does not render zeroes.
  "Nothing is published" is the one conclusion an Owner must not draw from an
  outage, and the read fails closed as a whole rather than mixing real page
  states with zeroed counts that would still look authoritative.

From there: `/app/site-content` for the ten pages, `/app/posts` for articles,
`/app/gallery` for media with `/app/gallery/order` for the public sequence, and
`/app/site-settings` for the shared header, footer and contact details.

## Publishing, from the operator's side

The server has always been idempotent: every publication event carries a request
key with a unique index behind it, and a repeat is answered `already_published`
rather than appended. What that cannot do is tell the person in front of it that
the first click was received, which is exactly why someone clicks again.

One shared control renders every publish, republish and unpublish. It disables
itself *after* the browser accepts the submission — disabling during the click
would cancel the request it was meant to send — and the request key is generated
once per page render, so both clicks of a double-click carry the same key and
the second is recognised as the same request.

Unpublishing asks first, and the question says what it does and does not do:
nothing is deleted, the history stays, and it can be published again. Publishing
does not ask, because it adds rather than removes. The home page is offered no
hide control anywhere, because `trg_site_home_cannot_hide` would refuse it.

Each editor states which revision it has loaded and whether that revision is the
one the public currently has. Opening an older revision to restore it otherwise
looks identical to opening the newest one, and the difference decides what the
next save contains — it says as well that saving always appends, because "am I
about to lose the current version" is the question that stops people using the
history at all.

## News and articles

Posts are published to `/news/`, which the public contract has named since
before anything served it. The index lists published posts newest-first by their
*first* publication, so a corrected typo does not throw an old article back to
the top, with the slug as the tie-break — the same rule `comparePostsForList`
applies in the statically built release, so a batch published in the same second
lists identically in both.

What is live is the most recent publication event, as it is for pages. Because
the schema's CHECK makes `revision_id` non-null exactly when the action is
`PUBLISH`, "the latest event carries a revision" and "currently published" are
one condition rather than two that have to agree. `publishedAt` is the first
`PUBLISH` and `updatedAt` the most recent one, and a post published only once
reports no edit at all rather than repeating its publication date.

Both routes resolve per request. The index distinguishes an empty archive from
an unreachable one and says which. An article that is not published answers 404
rather than rendering, and `NOINDEX` is the editor's choice — the route honours
it and omits the Article structured data with it.

Media on a post is served through `/api/gallery/images/:id`, the same
authorization-aware route every managed marketing page uses, which serves a
`PUBLISHED` + `PUBLIC` item to anyone and refuses everything else. It is
deliberately not the `/assets/` form `lib/public-cms/contract.ts` requires: that
contract describes the statically built release served from a document root, and
where runtime CMS media lives under `/assets/` is an open deployment decision
recorded in `docs/LANE_A_ASKS_20260825.md`.

Renaming a post is not possible from the editor, and that is deliberate until
slug history exists: `uq_posts_slug` has no history table behind it, so a rename
would overwrite in place and every inbound link to the old URL would be lost at
the moment of saving.

## Production activation

1. Back up D1 and record table counts/checksum evidence.
2. Dry-run migrations through `0013` on an isolated copy.
3. Apply missing migrations exactly once using a migration ledger.
4. Verify private R2, Supabase Auth and real OWNER mapping.
5. Grant `site:*` and `gallery:*` permissions only to approved staff.
6. Save and publish one global settings revision; verify shared Header/Footer, structured data and Audit without exposing a private Gallery image.
7. Save a page revision, preview it, publish it and verify Audit records.
8. Republish older settings and page revisions and prove rollback without deleting history.
9. Batch-upload real approved photographs; verify variants/checksums, then publish one item.
10. Prove anonymous users can read only public/published media and two customer companies remain isolated.
11. Only then expose the application route/callback approved by the Owner.

Schema rollback after Production apply is forward-only or backup restore. Never delete page history, Gallery metadata or R2 originals merely to roll back the UI.
