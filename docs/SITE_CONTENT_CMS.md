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
