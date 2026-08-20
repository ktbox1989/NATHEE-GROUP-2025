# Site Content CMS

## Purpose and boundary

The Site Content CMS lets an authorized OWNER or STAFF member manage the public Home, Services, About and Contact pages without editing source files. It is structured content, not a raw-HTML editor: the server accepts only allowlisted section types and bounded fields, React escapes all text, and links are limited to local paths, page anchors and telephone links.

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
- Rollback never rewrites history; it appends a new publication event pointing at an older revision.
- A database trigger prevents publishing a revision from another page.
- The Home page cannot be hidden, avoiding an accidental blank root route.
- When the CMS tables are unavailable or no revision has been published, the accepted source-controlled Home remains active. Other managed routes use bounded source defaults.

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

## Production activation

1. Back up D1 and record table counts/checksum evidence.
2. Dry-run migrations through `0012` on an isolated copy.
3. Apply missing migrations exactly once using a migration ledger.
4. Verify private R2, Supabase Auth and real OWNER mapping.
5. Grant `site:*` and `gallery:*` permissions only to approved staff.
6. Save a revision, preview it, publish it and verify Audit records.
7. Republish an older revision and prove rollback without deleting history.
8. Batch-upload real approved photographs; verify variants/checksums, then publish one item.
9. Prove anonymous users can read only public/published media and two customer companies remain isolated.
10. Only then expose the application route/callback approved by the Owner.

Schema rollback after Production apply is forward-only or backup restore. Never delete page history, Gallery metadata or R2 originals merely to roll back the UI.
