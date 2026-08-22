# NATHEE GROUP 2025 — Canonical Project State

Updated: 2026-08-21 (Asia/Bangkok)

## Source checkpoint

- Branch: `main`
- Full HEAD: `9e75d5c7118b87619cb81ff992b2ee155eb33784`
- Remote `origin/main` verified equal to local HEAD.
- Latest verified implementation milestone: Installable public website (`9e75d5c`)
- Canonical repository: `ktbox1989/NATHEE-GROUP-2025`
- Working rule: resolve the current checkpoint-document commit with `git rev-parse HEAD`; never infer Production deployment from source HEAD.

## Production evidence

Measured directly against the live domain at `2026-08-22T16:23Z`. The previous
revision of this document claimed the Production Gallery was live with nine
photographs. That was not true of the running site and has been corrected.

- Public static website: LIVE at `https://natheegroup2025.com/`
- Z.com root: `/home/zptqqwps/public_html/natheegroup2025.com`
- Public routes: 11, all HTTP 200, with SEO/noindex/mobile gates
- **Production is running a stale release.** It predates `22a5454`
  (responsive layouts and media delivery), so several accepted milestones are
  built and committed but not serving.
- Live homepage: 12,490 bytes and **0** real work photographs. The accepted
  release is 23,212 bytes with 7.
- Live `/gallery/`: 7,431 bytes, **0** `<img>` elements, and still renders the
  client-side `loading` placeholder. The accepted release server-renders 9
  photographs with 18 `<source>` variants.
- Live gallery assets: **32 of 54** variants return 200. The 22 missing are
  every AVIF variant plus the WebP display/thumbnail pair for
  `motorcycle-storage-yard-01` and `motorcycle-truck-loading-01`.
- `/assets/gallery.json`, the brand artwork and the Owner-supplied LINE QR are
  live and return 200.
- Canonical `/login/`: static noindex status page, not real Auth
- Canonical `/app`: 404
- Canonical `/api/health`: 404
- Protected Sites artifact: Version 4, source `9afd58d`, owner-only access
- Protected Sites environment variables: none configured
- Protected Sites D1: only the ten base tables from migration `0000`
- Full application Production acceptance: NOT PASSED

## Closed local milestones

### The database invariants that decide who can administer the platform are proven

- Found that the readiness contract **required** the last-active-OWNER and
  role/company compatibility triggers to exist, and nothing anywhere proved what
  they do. "Present" was the entire guarantee for the two invariants that decide
  whether this platform can be administered at all.
- Proven against the real migrated schema: the last active OWNER cannot be
  deactivated, archived, demoted, or have their role assignment changed or
  deleted; with a second OWNER present either may be stood down, and the
  remaining one is protected again; and an **inactive** OWNER does not count
  towards the guarantee, so two OWNER rows do not make one of them removable.
- Writing those tests corrected two assumptions. Demoting the last OWNER through
  the legacy role column is refused as an *incompatible pairing* rather than by
  the last-owner rule — blocked either way, but by the earlier trigger. And a
  company-less customer account cannot be created at all, so an unscoped customer
  role has nothing to attach to: the guarantee holds one step earlier than the
  role assignment. Both are now recorded as they actually behave.
- Role and company always agree: a customer account cannot receive OWNER, ADMIN,
  STAFF or WAREHOUSE; a staff account cannot receive a customer role; and an
  existing assignment cannot be edited into an incompatible pairing, so a
  customer cannot be promoted to OWNER by editing the assignment alone.
- `scripts/test-migration-inventory.mjs` covers what is only visible across the
  whole inventory: a gapless duplicate-free sequence, filenames in convention, a
  ledger that agrees with the files in order and with timestamps that do not go
  backwards, and **nothing destructive after the base migration**. The four
  table rebuilds are recognised as legitimate only because they copy their rows
  forward; a bare `DROP TABLE`, a `DROP COLUMN`, a `DELETE` or a `TRUNCATE` is
  refused.
- That gate found a real documentation defect: `docs/PRODUCTION_GO_LIVE.md`
  required verifying the ledger but **never said to take a backup first** — for
  an operation that is not reversible by re-running it, against a database of
  real customer records. The backup requirement and the "restore, do not
  continue from a failed apply" instruction are now in the runbook.
- Twelve proven rejections + 1 acceptance for the inventory gate, including a
  sequence gap, a duplicate index, a ledger that claims or misses a migration,
  backwards ledger timestamps, each destructive statement kind, and the runbook
  losing its backup or ordering instruction.
- Verification: full tests 375/375 (183 unit + 192 integration), 10 of them new;
  TypeScript PASS; ESLint PASS; Vinext production build PASS; all ten gates PASS.
- No migration was added or applied. Migrations `0000`–`0025` remain unapplied to
  Production.

### The environment verifier now covers bindings and browser-visible secrets

- Extended `npm run verify:env` to the two checks it was missing. It confirms the
  artifact declares the D1 `DB` and private R2 `FILES` bindings — declared rather
  than probed, because the verifier runs before anything is deployed and
  `/api/health` is what answers whether the live bindings exist.
- Added the check for the mistake that **cannot be walked back**: any
  `NEXT_PUBLIC_` value carrying a secret shape — a Supabase secret, a JWT (which
  for Supabase is a service-role token), a provider `sk-` key, or a PEM private
  key. Those values are compiled into pages customers download, so once shipped
  the value is public and must be rotated, not removed. The refusal names what
  kind of secret it found and still never prints the value.
- An ordinary public value such as a site name or an analytics id is not
  mistaken for a secret.
- Covered the carriage-return case explicitly. Copying a value from a Windows
  file or terminal appends `
`, and the verifier accepts it **because the
  runtime accepts it** — both trim. A verifier that failed there would send the
  Owner hunting a problem that does not exist, and the printed dashboard values
  are asserted to carry no stray carriage return either.
- Verification: full tests 365/365 (183 unit + 182 integration), 5 of them new;
  TypeScript PASS; ESLint PASS; Vinext production build PASS; all nine gates
  PASS.
- No Production value was read. Whether the live D1 and R2 bindings exist stays
  an Owner gate.

### Private storage cannot be read, written or cached without a decision

- R2 holds what a customer would least like published: inspection and damage
  photographs, Proof of Delivery evidence, recipient signatures and quotation
  attachments. The bucket is private, so the only path to a browser is a route in
  this application — which makes those routes the entire contract.
- Every one of the four read routes and four write routes was already correct.
  What was missing was anything keeping them that way, and both failure modes are
  quiet: an unauthorized read returns bytes and looks like a working feature, and
  a shareable cache header publishes a customer's evidence to whoever asks the
  CDN next while every log line stays green.
- `scripts/test-private-media-contract.mjs` requires an authorization decision in
  the same request as any object read or write, and requires a response carrying
  object bytes to declare `private, no-store`. Where a shareable header is used
  at all it must be **conditional on a proven public state**, and "public" must
  mean PUBLISHED and PUBLIC decided from the stored row rather than asserted.
- Two exemptions, both declared with their reason and both checked rather than
  trusted. The readiness probe may `head` a key that is never written and must
  return a boolean, never bytes — if it starts reading real objects the gate
  fails. The public quotation intake is the one place an unauthenticated caller
  may write, and its same-origin, Turnstile and bounded-request guards are each
  asserted; it must also never read an attachment back.
- A stale exemption fails too: if the probe stops touching storage, or the
  declared public writer stops writing, the gate reports the exemption as stale
  rather than leaving a hole nobody notices.
- A storage key is internal layout and must not be returned to a client; the
  binding must stay `FILES`; and the private-storage requirement must stay
  documented in the deployment architecture.
- Twelve proven rejections + 1 acceptance, including an unauthorized read of
  private evidence, a signature read without a decision, a quotation attachment
  that stops being Owner-only, private bytes marked shareable, `isPublic` forced
  true, each public-intake guard removed individually, a probe that starts
  reading real objects, a brand-new unauthenticated write route, and the bucket
  binding renamed away.
- **No Production R2 configuration was created or guessed.** Whether the live
  bucket is private remains an Owner gate; this proves the application never
  relies on it being public.
- Verification: full tests 360/360 (183 unit + 177 integration); TypeScript PASS;
  ESLint PASS; Vinext production build PASS; all nine gates PASS.

### Scanning a printed code proves nothing about who is holding it

- A QR sticker is on the motorcycle. Anyone walking past can photograph it, so
  two properties matter: the code carries no customer data, and resolving it
  reveals nothing to someone not entitled to that record. Both were true; neither
  was covered by a test.
- Proven against the real migrated schema: a printed identity is `mc_` plus 32
  hex from a random UUID and contains **no** VIN, engine number, company id or
  internal row id — asserted against the actual seeded secrets rather than by
  eye. Two hundred freshly minted identities never repeat, and an identity of one
  entity type never validates as another.
- An unauthenticated scan of a vehicle, job, yard or truck code resolves to
  `unauthorized` in every case.
- A customer resolves their own company's vehicle and job codes and is refused
  another company's. **The refusal is indistinguishable from a code that does not
  exist** — both answer "not found" — so a scanner cannot enumerate which
  identities are real by watching for a different refusal.
- Yard, truck and trip codes are internal operational assets and stay
  unresolvable for a customer even when that customer's own vehicles are in the
  yard. Staff resolve them only with the matching capability: `yard:read` opens a
  yard code, `jobs:read` alone does not.
- A malformed, truncated, over-long, SQL-shaped or cross-type identifier is
  refused before any lookup happens.
- Print surfaces demand a **write** capability rather than the ability to look: a
  customer may read their own motorcycle and still cannot print its operational
  label, which is an internal artefact.
- The six routes these cases mirror are asserted to still scope the way the cases
  assume, including that the shared QR helper keeps its 401 and its internal-only
  branch.
- Verification: full tests 360/360 (183 unit + 177 integration), 10 of them new;
  TypeScript PASS; ESLint PASS; Vinext production build PASS; every gate PASS.
- No migration was added. No Production file, D1 row, Supabase value, R2 object,
  DNS record or credential was changed.

### A session is no longer enough to change who may act

- Closed the last case where possession of a session was full authority.
  Inviting a member and changing a role, permission set or account status
  required only a session that resolved to OWNER. A stolen OWNER session could
  therefore **invite a second OWNER and keep that access after the real Owner
  changed their password** — persistence, not merely impersonation.
- Both writes now require the actor's current password, verified through the
  identity provider on the same request that performs the write. The OWNER-only
  check is unchanged and additional, not replaced.
- There is deliberately **no "sudo window"**. A time-boxed grant would be more
  state to store, another lifetime to get wrong and another cookie worth
  stealing. These actions are rare and consequential, so each carries its own
  proof.
- Verifying the password is a password guess, so it reserves from the same
  `login:*` budgets a guess at `/api/auth/login` would, **before** the provider
  is asked anything. A counter the guard cannot reach refuses the write rather
  than waving it through.
- An absent password and a wrong one are refused identically, because reporting
  them differently tells an attacker which half to work on.
- Re-authenticating rotates the session, so all nine exits from the role-change
  route and all six from the invitation route now carry the refreshed cookies —
  otherwise a successful change would sign the Owner out of their own success.
- The admin page asks for the password on both forms and explains why. A control
  that is only reachable by hand-crafting a request is not a control.
- Verification: full tests 350/350 (183 unit + 167 integration), 6 of them new;
  Auth wiring gate now 37 proven rejections + 1 acceptance, including an
  invitation that stops requiring the password, a proof that is obtained but
  never checked, an unreachable counter that lets the write through, and an
  admin page that stops asking; TypeScript PASS; ESLint PASS; Vinext production
  build PASS; every other gate PASS.
- No migration was added. No Production file, D1 row, Supabase value, R2 object,
  DNS record or credential was changed.

### The application moved to its own origin (Owner correction)

- The Owner corrected the application origin to `https://app.natheegroup2025.com`.
  The public marketing website stays on the apex `https://natheegroup2025.com`.
  The apex is now **refused** as an application origin rather than merely
  discouraged, because it is the single most plausible wrong value to type.
- The reason is a security boundary, not a preference. The public site is a
  static document root that a deploy script overwrites by file copy; the
  application holds authenticated sessions, customer records and private media.
  Sharing an origin would put every Auth cookie and every redirect target inside
  that document root's scope.
- `lib/app-origin.ts` now exports both origins and `isPublicWebsiteOrigin()`, so
  the environment verifier can name the specific mistake instead of reporting a
  generic rejection: *"set to the public website … The application has its own
  origin: https://app.natheegroup2025.com"*.
- Proven: the app origin is accepted and the apex, `www`, `http://`, a port, a
  path, and five lookalike hosts (`…com.attacker.invalid`,
  `app-natheegroup2025.com`, `evil.app.…`) are all refused; configuring the apex
  as `APP_ORIGIN` makes **every** same-origin mutation check deny rather than
  fall back to the request's own host; and the Supabase dashboard values the
  verifier prints are derived from the configured origin.
- Corrected the Auth callback, Site URL, `APP_ORIGIN` and the `/api/health`
  address across `.env.example`, `docs/AUTH_SETUP.md`,
  `docs/PRODUCTION_GO_LIVE.md` and `docs/DEPLOYMENT_ARCHITECTURE.md`, and
  recorded the routing model as decided.
- **`scripts/test-canonical-domain.mjs` is a Lane A gate that hard-coded the apex
  Auth callback in three files**, so the correction could not be applied without
  it failing. Rather than retarget it, it now encodes the two-origin reality: the
  public-site contracts still require the apex, the application contracts require
  the app origin, and a new check refuses a regression that puts `APP_ORIGIN` or
  the Supabase Site URL back on the apex. **This is a Lane A file and is flagged
  in the integration handoff.**
- Untouched: everything under `public-site/`, the Z.com deploy and verify
  scripts, and the public SEO canonicals — `lib/cms-public-route.ts`,
  `lib/site-structured-data.ts` and the public page metadata still point at the
  apex, which is correct because the public site remains the canonical copy.
- Verification: full tests 344/344 (177 unit + 167 integration), 5 of them new;
  TypeScript PASS; ESLint PASS; Vinext production build PASS; canonical domain,
  deployment architecture, readiness contract and all seven security gates PASS;
  `git diff --check` PASS.
- No migration was added or applied. No Production file, D1 row, Supabase value,
  R2 object, DNS record or credential was changed.

### The CMS delivery contract is enforced rather than habitual

- Checked the two properties that make Publish mean anything, and found both
  already true — but held by habit, with nothing keeping them true.
- **Revalidation.** All ten public pages that render managed content declare
  `force-dynamic`, so a publish is visible on the next request and there is no
  cache to invalidate. The failure this prevents is silent: a cached public page
  would let an editor publish, be told it succeeded, and leave the live site
  serving the previous revision with nothing reporting anything wrong.
- **Preview privacy.** The protected tree declares `index:false, follow:false`
  and resolves per request; preview requires an authenticated actor and
  `site:read`, renders through the same component as the live site with a
  "ยังไม่เผยแพร่" banner, and scopes the revision to its own page so one page
  cannot preview another's draft.
- **No draft has a path to an anonymous reader.** Nothing outside the protected
  tree reads `site_page_revisions` or `site_settings_revisions`; public pages
  resolve only through the published-state helpers, and the live revision is the
  one named by the most recent publication event, with a HIDE winning when it is
  most recent.
- `scripts/test-cms-delivery-contract.mjs` enforces all of it, with a negative
  test proving twelve specific breakages are rejected — a public page that stops
  being per-request, one that starts reading revisions, a helper that stops
  requiring a published state, a hide event that stops winning, an indexable
  protected tree, and a preview that loses its actor check, its capability
  check, its page scoping or its draft banner.
- Documented the delivery contract in `docs/SITE_CONTENT_CMS.md`, including what
  is **not** supported: there is no scheduled or expiring publish. That would
  need a runtime that wakes without a request, which this deployment does not
  have, so it is stated as absent rather than approximated.
- Rollback needed no new code and is now described accurately: revisions are
  immutable and publication events cannot be deleted, so restoring an earlier
  version is publishing that revision again, and the history records the
  rollback as its own event.
- Verification: full tests 339/339 (174 unit + 165 integration); TypeScript PASS;
  ESLint PASS; Vinext production build PASS; readiness contract and all seven
  security gates PASS; `git diff --check` PASS.
- No migration was added. No Production file, D1 row, Supabase value, R2 object,
  DNS record or credential was changed.

### Gallery mutation policy is testable, and draft media is proven not to leak

- The rules deciding what may be done to a photograph lived inline in
  `app/api/gallery/[id]/route.ts`, where no test could reach them: the route
  needs a Cloudflare binding to run at all. The policy is the part worth
  proving, so it moved to `lib/gallery-mutation.ts` and the route consults it.
  Behaviour is unchanged — the extraction is what makes it checkable.
- Proven about the mutation policy: editing a draft needs `gallery:write`, while
  publishing, hiding, featuring, unfeaturing **and any edit at all to an
  already-published item** additionally need `gallery:publish`; a PUBLIC
  photograph may not carry a company or job, and a CUSTOMER_JOB photograph may
  not lack either — that pairing is what stops a customer's job leaking onto the
  marketing site; an unknown visibility is refused rather than defaulted, while
  case and whitespace are normalised as the form posts them; publishing requires
  an active category, a rendered display variant, real alt text and a
  non-internal visibility; only a live public photograph can be featured; and
  hiding, archiving or unfeaturing clears the featured flag, so nothing stays
  promoted while invisible.
- `tests/gallery-public-contract.test.mjs` proves the public side against the
  real migrated schema, with a row in every state: of DRAFT, HIDDEN, ARCHIVED,
  INTERNAL, CUSTOMER_JOB, published-in-a-hidden-category and published-public,
  **only the last reaches an anonymous reader**. Hiding a live photograph removes
  it immediately and clears its featured flag; archiving removes it and
  re-publishing brings it back; hiding a category removes everything in it
  without touching a single row; and reordering changes only the order, proven
  against the opposite of the default tie-break so the assertion cannot pass by
  accident.
- All twenty-four combinations of status, visibility and category status are
  enumerated and the database query is required to agree with the shared policy
  on every one. Exactly one combination is public.
- These cases mirror route logic, which goes stale silently, so the filters they
  assume are asserted to still exist in `app/gallery/page.tsx` and
  `components/cms-public-page.tsx`.
- Verification: full tests 339/339 (174 unit + 165 integration), 18 of them new;
  TypeScript PASS; ESLint PASS; Vinext production build PASS; readiness contract
  and all six security gates PASS; `git diff --check` PASS.
- No migration was added. No Production file, D1 row, Supabase value, R2 object,
  DNS record or credential was changed.

### Cross-tenant isolation proven against real rows, not just the shape of the code

- Lane A's `tests/customer-isolation.test.ts` proves two things about the code's
  shape: `can()` denies customers across companies, and every route touching
  company-owned data calls *some* authorization check. Neither proves the check
  is handed the company that **owns the row being returned**.
- That distinction is the leak. `can(actor, "documents:read", actor.companyId)`
  always succeeds and satisfies a static "calls can() with a company" scan; the
  correct call is `can(actor, "documents:read", row.companyId)`. The new tests
  make that difference explicit and assert the wrong form would pass while the
  right form denies.
- `tests/customer-isolation-data.test.mjs` is behavioural: two companies with
  complete operational records in a real migrated database — jobs, motorcycles,
  status events, private evidence images, yard placements, gallery items,
  notifications and a **signed** Proof of Delivery with its signature object —
  walked through the real `can()` one surface at a time.
- Covered: every company-scoped list returns only the requester's company and
  the Owner still sees both; opening another company's record by id is refused
  rather than served, across jobs, motorcycles, evidence images, status events
  and yard placements; private media and documents are bound to the storing
  company, not the requester; the POD signature object is separately bound;
  operational report counts are company-filtered for customers and unfiltered
  for the Owner; notifications are recipient-bound, so even a company-mate is
  not a reader; and a customer holds no write capability over any company,
  including its own.
- The fixtures satisfy the real invariants rather than working around them: a
  POD is only accepted for an `ARRIVED` motorcycle with matching same-company
  `DELIVERY` evidence, and migration `0021` requires every new POD to declare
  signed evidence. Writing the fixture surfaced both rules.
- Behavioural tests that mirror route logic go stale silently, so eight
  constructs the cases assume — the list scopes, the row-company checks in the
  motorcycle detail, documents, images and POD signature surfaces, the report
  filter and the notification recipient filter — are asserted to still be
  present in those routes, and the two API surfaces are additionally asserted
  *not* to authorize on the requester's own company.
- Verification: full tests 321/321 (164 unit + 157 integration), 10 of them new;
  TypeScript PASS; ESLint PASS; Vinext production build PASS; readiness contract
  and all six security gates PASS; `git diff --check` PASS.
- No migration was added. No Production file, D1 row, Supabase value, R2 object,
  DNS record or credential was changed.

### Publishing now verifies the media it is about to show

- Reviewed the existing CMS backend against the Lane B scope rather than
  rebuilding it. Content schema, Draft→Preview→Publish, revisions, permissions
  (`site:write` / `site:publish`), idempotency by request key, append-only
  publication history and audit entries were already in place and correct, and
  `safeHref` already refuses anything but same-origin paths, fragments, `tel:`
  and one allowlisted map URL — so there is no script-URL hole in editor content.
- Closed the gap that was there: **publish did not check that the media a
  revision points at can actually be shown.** The public renderer serves a
  gallery item only when it is PUBLISHED and PUBLIC, falling back to the
  Owner-supplied static manifest, and renders nothing otherwise. So an editor
  could pick an image, save, publish, and get a live page with a missing hero,
  with no error anywhere — every individual step had succeeded.
- Publishing a page now collects the images and gallery categories its **enabled**
  sections reference, resolves them exactly the way the public renderer does, and
  refuses the publish naming the first reference a reader would not be served.
  Publishing global settings does the same for the brand logo, which appears on
  every public page and would otherwise blank site-wide.
- The editor previously printed raw codes (`ไม่สำเร็จ: publish_failed`). Outcomes
  are now stated in Thai, and the refusal names the failing reference. The
  identifier is sanitised on the way out and validated again on the way in, so a
  hand-edited query string cannot put anything into the page.
- Proven against the real migrated schema: a saved revision is not public until
  published; a newer draft does not replace the live one on save; hiding takes
  effect and re-publishing restores exactly the chosen revision; publication
  history cannot be deleted and revisions cannot be edited; a draft, internal or
  missing image is refused while a published public one passes; a hidden gallery
  category is refused; archiving an image a live page depends on does not rewrite
  the published revision; and the home page cannot be hidden at all, so the public
  site always has an entry point.
- One of those tests is load-bearing for an earlier milestone: **which
  publication event wins is decided by ordering `created_at`**, so the mixed
  timestamp representations fixed earlier could have silently un-hidden a page.
  That ordering is now covered directly.
- Verification: full tests 311/311 (164 unit + 147 integration), 25 of them new;
  TypeScript PASS; ESLint PASS; Vinext production build PASS; all public and
  security guards PASS; `git diff --check` PASS.
- No migration was added. No Production file, D1 row, Supabase value, R2 object,
  DNS record or credential was changed.

### "The schema is applied" now means every object the migrations create

- Found a serious readiness gap. `REQUIRED_DATABASE_OBJECTS` was curated by hand
  and had drifted badly: **48 of the 81 safety triggers were absent from it**,
  along with 19 of 37 tables and 50 of 57 unique indexes. Among the missing were
  `trg_users_keep_last_active_owner_status` and
  `trg_user_roles_keep_last_active_owner_delete` — the protection that stops the
  platform being left with no OWNER — and
  `trg_user_role_assignments_compatible_insert/update`, which keeps a role and a
  company scope compatible and is part of customer isolation.
- A Production runtime missing any of them enforces none of them and still
  answers `/api/health` as `healthy`, because nothing was looking. Triggers are
  precisely the objects that fail silently: the application keeps working and the
  invariant is simply gone.
- The contract is now the complete set — 37 tables, 81 triggers, 128 indexes —
  and `scripts/test-readiness-contract.mjs` derives the same three sets from the
  migrations and fails the build on any difference in either direction: an
  invariant that is not required, or a requirement no migration creates. It also
  requires the lists to stay sorted and free of duplicates so a diff shows what
  changed. Ten proven rejections + 1 acceptance.
- The probe had to change with it. It bound one query parameter per required
  object, which D1 caps far below 246; it now reads the schema catalogue in one
  parameterless statement and compares in the application. The gate fails if it
  goes back.
- `missingDatabaseObjects()` names what is absent, for an operator who has to fix
  it rather than a boolean that only says "no".
- Proven end to end against the real migrated schema: a fully migrated database
  satisfies the contract; dropping the last-OWNER trigger or the role/company
  compatibility trigger makes it unready and names exactly that object; **every
  one of the 81 triggers is individually proven to make the runtime unready if it
  goes missing**; an unrelated extra table does not; and a base-only database,
  which is what Production holds today, is refused.
- Verification: full tests 286/286 (149 unit + 137 integration), 8 of them new;
  readiness contract 10 proven rejections + 1 acceptance; TypeScript PASS; ESLint
  PASS; Vinext production build PASS; all public and security guards PASS;
  `git diff --check` PASS.
- No migration was added. No Production file, D1 row, Supabase value, R2 object,
  DNS record or credential was changed.

### Session refresh reaches every page that reads one, and the sign-in trail is usable (`0025`)

- Fixed a regression introduced by this lane's own password-change milestone.
  `/reset-password` began reading a session to decide whether to ask for the
  current password, but it sat outside the request proxy's matcher. A Server
  Component cannot write cookies, so when it refreshes an expired access token
  the rotated refresh token is computed and discarded, leaving the browser
  holding one the provider has already consumed. The concrete effect: a
  signed-in user returning after an idle period could not change their password
  — they were bounced to "link expired" instead. `/reset-password` is now in the
  matcher.
- `scripts/test-session-refresh-coverage.mjs` makes that structural. It walks
  every server surface, finds the 80 that resolve a session, converts the proxy's
  matcher entries into predicates and requires each surface to be covered. It
  also fails on a matcher entry that covers nothing, on a matcher shape it cannot
  verify, and if the proxy stops asking for the session or stops writing the
  refreshed cookies onto the response. Nine proven rejections + 1 acceptance.
- The Audit page now answers the two questions it is actually asked. `ทั้งหมด`
  is unchanged, `การเข้าสู่ระบบ` shows the three authentication actions, and
  `สิทธิ์ผู้ใช้` shows `INVITE` and `UPDATE_ACCESS`. An unrecognised view is a
  wrong URL rather than a silent fall back to everything.
- Authentication rows carry no free-text reason, so the detail column now reads
  how the person proved who they were — password, emailed link, or current
  password. A payload that is not a recognised method renders nothing rather than
  raw JSON.
- Additive migration `0025` adds `idx_audit_logs_action_created`, so a filtered
  view is index-seekable instead of scanning the whole trail; proven by
  EXPLAIN QUERY PLAN, and keyset pagination inside a filtered view is proven to
  walk the same order without repeating a row across pages.
- Verification: full tests 278/278 (149 unit + 129 integration), 12 of them new;
  session refresh coverage 80/80 surfaces with 9 rejections + 1 acceptance;
  TypeScript PASS; ESLint PASS; Vinext production build PASS; migrations through
  `0025` packaged; all public and security guards PASS; `git diff --check` PASS.
- No Production file, D1 row, Supabase value, R2 object, DNS record or credential
  was changed. Migration `0025` is unapplied, like `0001`–`0024`.

### Production environment values are checkable before a deploy

- Activation fails for boring reasons — a key pasted from the wrong dashboard
  field, the publishable and secret values swapped, a project URL with a path on
  it, an `APP_ORIGIN` that is not canonical. Every one of those produces a
  runtime that starts, refuses every login, and can only report
  `authentication: false`. `npm run verify:env` names the mistake instead.
- It applies the same validators the runtime applies rather than restating them,
  so the check cannot drift from the behaviour it predicts. Where the runtime
  validator takes two values together, each is checked against a well-formed
  stand-in for the other, so a wrong key is never reported as a wrong URL.
- When the origin is valid it prints the exact Supabase Auth Site URL and
  Redirect URL to enter, derived from the configured value rather than retyped.
- **It never prints a value it was given**, proven across every failure path
  including the one that reports a secret key sitting in the browser-visible
  slot. **It contacts no provider**: it proves the values are well formed and
  mutually consistent, not that Supabase accepts them, and it says so in its own
  output (`shapeOnly=true providerNotContacted=true`). Proving acceptance needs
  the real credentials against the live project, which stays the Owner's step.
- Verification: full tests 266/266 (142 unit + 124 integration), 10 of them new
  and all driving the real script in a child process with fixture values;
  TypeScript PASS; ESLint PASS; Vinext production build PASS; all public and
  security guards PASS; `git diff --check` PASS.
- No migration was added. No Production file, D1 row, Supabase value, R2 object,
  DNS record or credential was changed, and no Production secret was read.

### An Audit trail that records getting in, and cannot be rewritten (`0024`)

- The Audit trail recorded what people changed once they were inside and nothing
  about how they got there, so a compromised account left no trace at all unless
  it also changed something. `SIGN_IN`, `SIGN_IN_DENIED` and `PASSWORD_CHANGED`
  now reach `audit_logs` and appear in `/app/audit` alongside every other change,
  in the true chronological order the previous milestone restored.
- Each row is written by one `INSERT ... SELECT` keyed on the provider identity,
  so the actor, the company and the action all come from the authoritative
  `users` row read in the same statement. The provider identity is matched, never
  stored, and the action is decided by SQL from the account's own status — a
  deactivated account whose provider credentials still work is recorded as
  refused, not as a sign-in.
- **A provider identity with no application user writes nothing.** That is what
  keeps an unauthenticated path from growing the Owner's Audit table: someone who
  creates an account at the identity provider cannot make rows appear.
- Writing the entry is best effort and never costs a real user their login; by
  the time it runs, the attempt counter has already proved D1 was reachable.
- **The client address is deliberately not recorded.** It would help identify a
  compromise, and it would also make the Audit table a permanent location log of
  the Owner's own staff. That retention and consent decision belongs to the
  Owner, not to a default taken quietly here.
- Migration `0024` makes the whole trail tamper-evident: `audit_logs` now refuses
  UPDATE and DELETE, matching how signed POD, quotation records and import
  batches are already protected. Nothing in the application has ever updated or
  deleted an audit row, so this only removes a way to rewrite history; existing
  entries are preserved and new ones are still accepted. A runtime missing either
  trigger reports `/api/health` as `degraded`.
- Verification: full tests 256/256 (142 unit + 114 integration), 9 of them new
  and all running the real statements against the real migrated schema; Auth
  wiring gate 30 proven rejections + 1 acceptance; TypeScript PASS; ESLint PASS;
  Vinext production build PASS; migrations through `0024` packaged; all public
  and security guards PASS; `git diff --check` PASS.
- No Production file, D1 row, Supabase value, R2 object, DNS record or credential
  was changed. Migration `0024` is unapplied, like `0001`–`0023`.

### The Audit page was showing the day's events in the wrong order

- Found and fixed a real, user-visible defect while preparing to add
  authentication events to the Audit trail. `audit_logs.created_at` was written
  two different ways: routes using the Drizzle helper let the column default to
  SQLite's `CURRENT_TIMESTAMP` (`2026-08-23 23:59:00`), while routes using raw
  SQL bound an ISO-8601 string (`2026-08-23T00:00:01.000Z`). Text comparison puts
  `T` above a space, so **within any single day every raw-SQL event sorted above
  every Drizzle event regardless of the actual time** — a role change at one
  minute past midnight displayed above a company created at one minute to
  midnight. The Owner's record of who changed what was out of order, and the
  keyset pagination added by migration `0019` walked that same wrong order.
- The confusion was not limited to Audit. Twenty-four call sites wrote
  `new Date().toISOString()` into `created_at` and `updated_at` across
  motorcycles, trips, containers, yard zones, gallery, site content, settings,
  quotations, bulk imports and user management.
- `lib/timestamps.ts` now states the contract in one place. `recordTimestamp()`
  produces exactly what `CURRENT_TIMESTAMP` writes, for `created_at` and
  `updated_at` — the only two columns in the schema with a database default.
  `eventTimestamp()` produces ISO-8601 for every other `*_at` column, which
  records when something happened in the real world.
- The two are deliberately **not** interchangeable, and the reason is verified
  rather than asserted: `ck_yard_placements_time_order`, `ck_trip_assignments_
  time_order` and their siblings compare those columns against each other as
  text, so a record-form exit written against an ISO-form entry is rejected. A
  test proves that rejection, which is also why no migration rewrites existing
  rows — the representation switch is safe only because Production holds no
  application rows at all.
- Every call site now names which kind it means, so the choice is reviewable
  where it is made rather than inferred from the column later.
- `scripts/test-timestamp-contract.mjs` keeps it: no server source may use the
  `new Date().toISOString()` idiom that caused this, only `created_at` and
  `updated_at` may carry a `CURRENT_TIMESTAMP` default in the schema or in any
  migration, and a file writing one kind of column must be able to produce that
  kind of value. Eight proven rejections + 1 acceptance.
- Verification: full tests 247/247 (142 unit + 105 integration), 19 of them new;
  the ordering defect and its fix are both proven against the real migrated
  schema, including that keyset pagination stays index-backed on
  `idx_audit_logs_created_id`; timestamp contract 8 rejections + 1 acceptance;
  TypeScript PASS; ESLint PASS; Vinext production build PASS; all public and
  security guards PASS; `git diff --check` PASS.
- No migration was added and no stored row was rewritten. No Production file, D1
  row, Supabase value, R2 object, DNS record or credential was changed.

### Authorization coverage and response headers became build gates

- Server-side authorization held on all 84 protected surfaces, but it held
  because someone had checked each one by hand. `scripts/test-authorization-
  coverage.mjs` turns that into a build failure: every `route.ts` under
  `app/api` and every page or layout under `app/app` and `app/portal` must
  resolve the actor **and** decide with it. Resolving alone is identification,
  not authorization; it is what would let a signed-in customer read another
  company's records.
- Being public is still allowed, but only as one of six declared entries with a
  stated reason, so a missing check cannot be mistaken for an intended one. A
  declared entry that outlives its file also fails, because a stale exception is
  how a surface loses its check years later. Four QR routes satisfy the gate
  through a declared delegate, and the delegate is itself verified — delegating
  is not an escape.
- Every mutating handler must check same-origin, public or not: a session cookie
  travels with a cross-site form post.
- Fixed a real gap in `worker/index.ts`: the image-optimization path returned
  before `applySecurityHeaders`, so an optimized image was the one response
  served without any of them. `fetch` now has a single exit, and the gate
  requires it to stay that way by counting exits rather than inspecting branches.
- Added `Content-Security-Policy: base-uri 'none'; object-src 'none'; form-action
  'self'; frame-ancestors 'none'` and `Cross-Origin-Resource-Policy: same-origin`.
  These directives cannot change how the application loads its own scripts,
  styles or images, so they cannot break a render, but they close the ways an
  injected fragment becomes an account compromise — chiefly a form that posts a
  password off-site and a `<base>` tag that silently retargets every relative URL
  on the page. A `script-src`/`style-src` policy is deliberately **not** claimed:
  the RSC runtime inlines its own payload, so a correct one needs nonce
  propagation through the framework and real browser acceptance.
- The header gate asserts the policy **and** that the application contains no
  markup the policy forbids, across 117 sources. Asserting a policy without
  asserting compatibility is how a header gets quietly removed later.
- Verification: full tests 234/234 (135 unit + 99 integration); authorization
  coverage 84 surfaces, 78 authorized, 6 declared public, with 9 proven
  rejections + 1 acceptance; response headers 6 headers and 4 CSP directives,
  with 13 proven rejections + 1 acceptance; Auth wiring gate 24 rejections + 1
  acceptance; TypeScript PASS; ESLint PASS; Vinext production build PASS; public
  SEO/Gallery/mobile/responsive/PWA/deployment guards PASS; `git diff --check`
  PASS.
- No migration was added. No Production file, D1 row, Supabase value, R2 object,
  DNS record or credential was changed.

### Proof required before a password can be changed (`0023`)

- Closed an account-takeover path: `/api/auth/update-password` accepted any live
  session and changed the password without asking for the old one. Anyone
  reaching an unlocked browser, or lifting a session cookie, could take an
  account over permanently — for OWNER, that is control of every user, role and
  permission on the platform.
- The route now accepts exactly two proofs. The current password, which is
  verified through the provider and spends the same `login:*` attempt budgets a
  guess at `/api/auth/login` would. Or a **recovery grant**, which attests that
  the session came from a link sent to the account's mailbox — the only proof
  available to someone recovering a forgotten password or accepting an
  invitation. Holding a session is not a proof.
- `/auth/callback` is the only place a mailbox link becomes a session, so it is
  the only place that mints a grant: a 256-bit random value in an `HttpOnly`,
  `SameSite=Lax` cookie, valid 30 minutes. The database stores only its SHA-256
  digest, so reading the table yields nothing replayable.
- The grant is bound to one authentication identity and is single-use, both
  enforced by one conditional `UPDATE ... RETURNING`, so two simultaneous
  requests cannot spend it twice. Requesting a new link invalidates the unused
  one before it. `/reset-password` checks it read-only and asks for the current
  password when there is no usable grant.
- Grant issuance binds on the provider's identifier rather than a confirmed
  mailbox, because an invited user is completing confirmation at that exact
  moment; requiring confirmation first would break the invitation the control is
  meant to protect. Resolving an application role still requires a confirmed
  identity, unchanged.
- Expected behaviour change: a signed-in user who wants a new password must type
  the current one, or use the emailed link.
- Additive migration `0023_auth_recovery_grants` creates one table and two
  indexes. It changes no existing table, row, trigger or constraint.
- Verification: full tests 234/234 (135 unit + 99 integration), 20 of them new
  and 10 running the exact runtime statements against the real migrated schema;
  Auth wiring gate PASS with 24 proven rejections + 1 acceptance — two of which
  were found by writing the rejection first and were real weaknesses in the gate,
  now fixed; TypeScript PASS; ESLint PASS; Vinext production build PASS; public
  SEO/Gallery/mobile/responsive/PWA/deployment guards PASS; `git diff --check`
  PASS.
- No Production file, D1 row, Supabase value, R2 object, DNS record or credential
  was changed. Migration `0023` is unapplied, like `0001`–`0022`.

### Attempt budgets on the unauthenticated Auth routes (`0022`)

- Closed a real gap rather than a theoretical one: `/api/auth/login` and
  `/api/auth/forgot-password` accepted an unlimited number of attempts. Nothing
  in this application slowed a password guess against the OWNER account, and
  nothing bounded recovery mail to a mailbox the caller had merely guessed.
  Supabase's own limits are global to the project, cannot lock one targeted
  account, and cannot be proven in force from a Production runtime.
- Every attempt now spends two budgets before the provider is asked anything:
  one keyed on the submitted identity (5 login failures / 15 min, 3 recovery
  requests / hour) and one keyed on the client address (20 / 15 min, 15 / hour).
  Exhausting a budget escalates along a 15/30/60-minute ladder that decays after
  24 hours.
- Reserving before the provider call is what makes it fail closed: a request that
  times out or dies inside the provider has still spent its attempt. A D1 the
  route cannot reach refuses the request instead of falling through, and a
  runtime without `auth_attempt_counters` reports `/api/health` as `degraded`.
- Every decision is made by SQL, never by read-then-write application code, so
  simultaneous requests cannot lose an increment. If the settlement write is lost
  entirely the spent window alone still refuses the next attempt.
- A correct password clears only its own identity budget; the shared client
  budget is given back exactly the one attempt it lent, so an attacker holding
  one valid account cannot reset it between guesses. Recovery never reports
  success, because the reply is identical for a known and an unknown address, so
  the counter cannot become an existence oracle.
- The client scope reads only `CF-Connecting-IP`, which the edge overwrites;
  `X-Forwarded-For` would let one caller mint unlimited buckets. `scope_key` is a
  SHA-256 digest, so the table compares subjects without ever becoming a list of
  addresses typed at the login form, and unlocked rows untouched for 24 hours are
  reclaimed at most 50 per attempt.
- Additive migration `0022_auth_attempt_throttle` creates one new table and one
  index. It changes no existing table, row, trigger or constraint.
- Verification: full tests 214/214 (125 unit + 89 integration), of which 33 are
  new and 14 run the exact runtime statements against the real migrated schema;
  Auth wiring gate PASS with 12 proven rejections + 1 acceptance; TypeScript
  PASS; ESLint PASS; Vinext production build PASS; public SEO/Gallery/mobile/
  responsive/PWA/deployment guards PASS; release gate 9 rejections + 1
  acceptance; postcheck contract PASS; deploy file tools PASS; `git diff --check`
  PASS.
- No Production file, D1 row, Supabase value, R2 object, DNS record or credential
  was changed. Migration `0022` is unapplied, like `0001`–`0021`.

### Installable public website (`9e75d5c`)

- PWA readiness was in scope but entirely absent: no Web App Manifest, no icons beyond a 385-byte favicon and no Apple touch icon, so adding the site to a home screen produced a generic bookmark.
- Added `/site.webmanifest` (same-origin, `standalone`, scope `/`, Thai locale) with shortcuts to the real `/quotation/`, `/gallery/` and `/contact/` routes, plus 192, 512, maskable 512 and Apple 180 icons. The manifest link, Apple touch icon and `theme-color` are present on all eleven public routes and `/login/`.
- `scripts/generate-pwa-icons.mjs` derives every icon from the Owner-supplied brand artwork; nothing is invented. It is idempotent, rejects artwork that is not square or under 512px, pads maskable icons into a 64% safe zone and uses 256-colour palette PNGs (312KB total rather than 879KB).
- `.htaccess` declares `application/manifest+json`, because shared hosting serves an unmapped `.webmanifest` as `text/plain` and the browser then ignores it. The live postcheck asserts the response `Content-Type`.
- **No Service Worker is shipped and both verifiers fail if one appears.** A cache-first worker on a static marketing site can keep serving a superseded release, which is the exact failure Production is recovering from. Offline support stays a separate reviewed decision.
- Verification: icon PNG `IHDR` headers parsed and matched against the declared sizes, release gate 9 negative cases + 1 positive, postcheck contract 29 routes PASS, full tests 174/174 (106 unit + 68 integration), TypeScript PASS, ESLint PASS, Vinext production build PASS, SEO and deploy-tools gates PASS. Critical mobile payload 61,081 of 102,400 bytes.
- No Production file, backup, DNS record or credential was changed. This ships with the same pending public deployment.

### Repaired the Z.com release gates (`3df9c43`, `f01f561`, `53ec689`)

- Found the reason Production is stale: **the deployment could not succeed.**
  Both release gates still required the homepage to embed the brand artwork as
  an `<img>`, which the accepted homepage no longer does because the hero now
  leads with real company work photography.
- `scripts/verify-public-site.sh` runs before any backup or mutation, so it
  aborted the deploy outright. `scripts/postcheck-production.sh` runs *after*
  the release is applied and `deploy-zcom.sh` restores the backup when it
  fails, so a correct release would have been applied and then rolled straight
  back. Both are fixed.
- Both gates now verify the real contract: brand artwork through structured
  data and Open Graph, a homepage that server-renders real work photography,
  a `/gallery/` that server-renders the nine approved photographs, no
  server-rendered loading placeholder, and no reference to an `/assets/` file
  the release does not ship (covering `src`, `href` and every `srcset`
  candidate). The postcheck additionally requires the JPEG, WebP and thumbnail
  variants to resolve over HTTP, so a release that 404s its own images fails.
- Fixed a silent-failure defect in the verifier: under `set -o pipefail` a
  zero-match `grep` made a count assignment return non-zero, so `set -e` killed
  the script with no output before `fail()` could report the reason.
- `scripts/test-public-site-gate.sh` proves all four new guards by rejecting
  deliberately broken copies of the real release, and confirms the unmodified
  release still passes. `scripts/test-production-postcheck-contract.sh`
  resolves every route the postcheck fetches against the real release and runs
  the postcheck's own extracted assertions against those bytes, so the two
  cannot drift; restoring the old assertion makes it fail, so it is not
  vacuous. Both run in CI and in the documented Z.com runbook.
- Both tests create scratch directories through the shared
  `nathee_make_temp_dir` helper, verified with `NATHEE_DISABLE_MKTEMP=1` and a
  home-directory parent to match Z.com shared hosting.
- Verification: gate negative tests 4/4 plus 1 positive, postcheck contract 24
  routes PASS, full tests 174/174 (106 unit + 68 integration), TypeScript PASS,
  ESLint PASS, Vinext production build PASS, `verify-public-site.sh`,
  `test-public-seo-gates.sh` and `test-deploy-file-tools.sh` PASS.
- No Production file, backup, DNS record or credential was changed. The public
  release is unblocked but **not yet deployed**; it needs one Z.com Terminal
  run, which this runtime cannot reach.

### Bounded multipart uploads before parsing (`c9f20f7`)

- Closed a request-budget bypass: several heavy endpoints converted a missing `Content-Length` to zero and then parsed the multipart body. Gallery, private evidence, signed POD, motorcycle import and public quotation now share one fail-closed contract before `request.formData()`.
- The contract requires `multipart/form-data` with a non-empty bounded boundary and an explicit positive integer byte length. Missing/invalid length returns 411, unsupported media returns 415 and over-budget payload returns 413 (or the existing safe form error redirect).
- Static coverage requires all five heavy routes to keep the shared guard, while unit coverage checks quoted boundaries, missing/zero/fractional lengths and exact/over-limit sizes.
- Verification: full tests 174/174 (106 unit + 68 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, scoped secret scan PASS and `git diff --check` PASS.
- No migration was added and Production remains unchanged. Real browser/Cloudflare multipart acceptance remains part of the gated application runtime acceptance.

### Server-verified image artifacts and R2 compensation (`5629c21`)

- Closed a data-correctness gap shared by Gallery and private motorcycle evidence: the server previously verified MIME signatures but persisted width/height supplied by the browser. New uploads now derive JPEG, PNG, WebP and ISO-media (AVIF/HEIC/HEIF) dimensions from the actual bytes, reject mismatched client claims and reject decoded geometry above 80 million pixels.
- Verified the parser against the real checked-in JPEG, WebP and AVIF release variants (1600×900). Persisted responsive metadata now describes the stored artifact rather than an untrusted request field, protecting aspect ratio, layout stability and evidence review.
- Gallery, evidence and quotation object writes now register every candidate key before the potentially ambiguous R2 call. Cleanup uses all-settled compensation; image routes report cleanup uncertainty explicitly and never throw past reconciliation or claim an unproved success.
- Verification: full tests 172/172 (105 unit + 67 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, real-artifact dimension checks PASS, scoped secret scan PASS and `git diff --check` PASS.
- No migration was added and Production remains unchanged. Real R2/browser acceptance still requires the gated full application runtime, Auth/Owner mapping and existing migrations.

### Fail-closed Gallery batch uploads (`ab3c868`)

- Repaired a real false-success defect: XHR previously followed an API validation redirect to an HTML page and treated the resulting HTTP 200 as a completed Draft. The uploader now accepts success only from a complete JSON contract containing `ok=true`, the canonical Gallery item ID and duplicate state.
- Each queued file receives one cryptographically secure request key that survives network-error retry. The API strictly validates that identity; duplicate and concurrent requests return the same canonical item instead of creating a second Draft.
- The server bounds aggregate request size, rejects non-multipart uploads and returns explicit JSON errors for the client contract while preserving redirect behavior for non-XHR forms. A failed D1/race path best-effort removes only its own new R2 objects and checks the unique request key before reporting failure.
- Added the same 80-million decoded-pixel safety ceiling used by private evidence processing, and centralized browser UUID generation with a secure `getRandomValues` fallback.
- Verification: full tests 168/168 (103 unit + 65 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, false-success/identity regressions PASS, scoped secret scan PASS and `git diff --check` PASS.
- No migration was added and Production remains unchanged. Real browser upload/R2 acceptance still requires the gated Auth/D1/R2 application runtime.

### Private signed Proof of Delivery (`7a5bf0d`)

- New POD creation captures the real recipient, time, location, same-motorcycle `DELIVERY` photograph and a recipient signature in one fail-closed flow. The browser shows upload progress/cancel/retry states and uses cryptographically secure UUID request identities without relying on `crypto.randomUUID` availability alone.
- Signature PNG bytes are checked server-side for MIME signature, actual IHDR dimensions, size and SHA-256 before being written to private R2. D1 commits POD, immutable signature metadata and a redacted Audit entry atomically; a failed or concurrency-losing write compensating-deletes only its newly created R2 object.
- Additive migration `0021_zippy_impossible_man` leaves every legacy POD unchanged with `signature_required=0`. It requires all new POD rows to declare signed evidence, prevents signed POD delivery until the matching signature row exists and makes signature metadata immutable/non-deletable.
- Authorized detail and print views show the private signature; legacy unsigned records are labelled honestly. A new record missing its signature is visibly invalid and cannot move the motorcycle to `DELIVERED`.
- Verification: full tests 166/166 (101 unit + 65 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, migration preservation/integrity/immutability/query-plan checks PASS, scoped secret scan PASS and `git diff --check` PASS.
- Production remains unchanged. Browser acceptance of real pen/touch input and private R2 retrieval requires the gated application runtime, Auth/Owner mapping and migration `0021`; no D1 row, R2 object, Z.com file or Production setting was changed.

### Private motorcycle evidence derivatives (`0f3f182`)

- New authorized motorcycle-image uploads retain the original private R2 object and also create bounded WebP Display (long edge 1,600px, at most 3 MB) and Thumbnail (long edge 640px, at most 1 MB) objects. AVIF is optional and content-negotiated only when the browser advertises support.
- The authenticated image endpoint remains company/permission scoped and `private, no-store`. Thumbnail grids no longer request originals; inspection/POD links request Display. Existing rows with no variants safely fall back to their unchanged original object and are not rewritten or deleted.
- Uploads use a cryptographically generated request key plus a database unique index. Concurrent/retried submissions resolve to one canonical image row; failed R2/D1 attempts compensating-delete only the objects they created and never report false success.
- Additive migration `0020_awesome_quentin_quire` creates variant metadata, adds the nullable request key for legacy compatibility and makes motorcycle evidence/variant rows immutable and non-deletable. Preservation, constraints, duplicate-key, foreign-key and EXPLAIN coverage pass.
- Verification: full tests 160/160 (96 unit + 64 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, scoped secret scan PASS and `git diff --check` PASS.
- Production remains unchanged. Migration `0020`, the full app runtime and Auth/Owner mapping remain Production gates; no D1 row or R2 object was changed.

### Truthful operational reports and Audit keyset pagination (`3232992`)

- Added `/app/reports` with current-state Job, Motorcycle, Trip, Container and Yard aggregates calculated from authorized D1 rows. Customer roles receive only their company Job/Motorcycle counts; missing statuses remain absent and no KPI, finance, SLA or Invoice values are invented.
- Reports are responsive and printable with a render timestamp. The UI states its operational-only boundary and keeps finance reporting blocked until authoritative tables and business policy exist.
- Replaced the Audit UI's fixed latest-200 read with descending `(created_at, id)` keyset pages of 50. Additive migration `0019_supreme_imperial_guard` adds the chronological index only; preservation and EXPLAIN tests prove existing Audit history remains and pagination is index-backed.
- Runtime readiness now requires the `0019` index and stays degraded if Production schema is behind.
- Verification: full tests 153/153 (90 unit + 63 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, scoped secret scan PASS and `git diff --check` PASS.
- Production remains unchanged. Migration `0019`, the full app runtime and Auth/Owner mapping remain Production gates.

### Bounded real-data Print Center (`28b8c6c`)

- Added internal-only `/app/print-center` for authorized staff to find real Job, Motorcycle, Yard, Truck, Trip and Container records and open their existing QR, Inspection/POD, Trip Load Board or Container Load Manifest print surfaces.
- Search rejects wildcard/control-character scans, requires a 2–80 character prefix and bounds results to 50 plus one truncation sentinel. Dedicated query-plan coverage proves all eight identifier paths use an index, including the partial VIN/engine indexes.
- Every destination repeats server authorization; QR actions remain write-permission-gated. Customer roles cannot enter the operational directory, and missing Invoice/finance-report source contracts are shown as unavailable rather than fabricated.
- Verification: full tests 150/150 (88 unit + 62 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, scoped secret scan PASS and `git diff --check` PASS.
- No migration was added and Production remains unchanged. The route requires the full application runtime, confirmed Auth mapping and D1 migrations through `0018`; it is not served by the current Z.com static deployment.

### Opaque operational QR identities and labels (`55de6ab`)

- Extended the existing motorcycle QR contract to Job, Yard, Truck and Trip using type-prefixed 128-bit opaque public identities; sequential database IDs and business numbers are never encoded in labels.
- Added authenticated same-origin SVG routes, permission-scoped printable labels and a single scanner that resolves all five entity types from real D1 records. Customers may resolve only their own company Job/Motorcycle; Yard, Truck and Trip remain internal-only and unauthorized records use the same not-found response.
- Migration `0018_unknown_blonde_phantom` safely backfills Job/Yard identities without rebuilding populated tables, canonicalizes pre-Production Truck/Trip identities and enforces valid, unique, immutable identities with indexed lookups and database triggers.
- Verification: full tests 147/147 (86 unit + 61 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, migration preservation/format/immutability/query-plan checks PASS, scoped secret scan PASS and `git diff --check` PASS.
- Production remains unchanged. Migration `0018`, Auth/Owner mapping and dynamic application routing are still Production gates; no QR identity or operational record was created in Production.

### Atomic motorcycle CSV/XLSX imports (`c314e6f`)

- Added authenticated internal-only upload, reconciliation and confirmation routes for 1–500 motorcycles tied to one active Job. No motorcycle is created during upload; confirmation is disabled until every row passes validation.
- The bounded UTF-8 CSV/native XLSX parser supports Thai/English headers and the full operational vehicle fields. It rejects unknown/duplicate headers, missing identifiers, formulas, malformed worksheet references, unsafe ZIP paths, oversized requests/files and XLSX expansion beyond the declared safety budget.
- Migration `0017_parallel_spirit` adds an immutable import batch/row ledger and extends motorcycle records with variant, model year, province, NEW/USED/UNKNOWN condition and notes without rebuilding the existing motorcycle table or removing earlier lifecycle triggers. Existing per-Job sequence counters are reconciled upward, never reused.
- Exact D1 confirmation SQL is shared with the integration harness: one transactional plan claims the batch, allocates the full sequence range, creates 500 motorcycles/status events/Audit entries, advances the Job and closes reconciliation. A late VIN collision rolls back every change and consumes no sequence range.
- Verification: full tests 143/143 (84 unit + 59 integration), including a real XLSX ZIP, 500-row atomic import, retry rejection and uniqueness-race rollback; TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, migration preservation/integrity checks PASS, scoped secret scan PASS and `git diff --check` PASS.
- Production remains unchanged. Migration `0017`, Auth/Owner mapping and dynamic application routing are still Production gates; no real customer/fleet file was imported.

### Server-verified quotation anti-abuse (`a2873da`)

- Added Cloudflare Turnstile implicit widget support only when both the public site key and server-only secret pass validation. With missing/placeholder/partial configuration the online form is not rendered and verified phone contacts remain available.
- `POST /api/quotation` now requires Siteverify before reading/storing attachment bytes. Validation is server-only, uses a five-second timeout, one idempotent retry, the client request UUID, optional trusted Cloudflare IP and exact `hostname=natheegroup2025.com` plus `action=quotation` matching.
- Existing successful request keys still resolve idempotently without consuming a second one-time challenge. New requests fail closed on token absence, expiry/replay, provider error, action mismatch or hostname mismatch.
- `/api/health` now has a sixth `antiAbuse` gate; both Turnstile values are required while the secret is excluded from rendered HTML, public variable names, logs and repository values.
- Verification: full tests 133/133 (78 unit + 55 integration), TypeScript PASS, ESLint PASS, Production build PASS, configured/unconfigured SSR PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, secret scan PASS and `git diff --check` PASS.
- Production remains unchanged. Real Turnstile keys and the untrusted-file handling policy are Owner gates; no credential, Sites version, D1/R2 resource or Z.com file was changed.

### Private quotation evidence and audited Owner retrieval (`af2b397`)

- Extended the real quotation form with up to five private PDF/CSV/XLSX/image attachments. The server enforces an 8 MB per-file and 20 MB combined bound plus extension/MIME/signature agreement before storing bytes.
- R2 stores unique private objects; additive migration `0016_numerous_shatterstar` stores immutable filename/type/size/storage-key/SHA-256 metadata, rejects duplicate content in one request and prohibits update or hard delete.
- A quotation, all attachment metadata and redacted submission Audit commit in one D1 batch. Any R2 objects created before a failed/concurrent D1 write are compensating-deleted; cleanup failure is fail-closed and never reports success.
- Only OWNER can retrieve an attachment. Download is forced with no-store/nosniff headers, missing/cross-role records return a generic denial and every successful read requires an Audit write first.
- Verification: full tests 130/130 (76 unit + 54 integration), TypeScript PASS, ESLint PASS, Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, migration upgrade/integrity/index checks PASS, secret scan PASS and `git diff --check` PASS.
- Deployment boundary: migration `0016`, dynamic form/API and R2 flow are source-only. Z.com public static files and all Production services remain unchanged. Production activation still requires the existing Auth/routing/D1/R2 gates plus an approved anti-abuse and untrusted-file policy.

### Commercial proof and durable quotation intake (`c5fbaa5`)

- Replaced public Home/Gallery loading placeholders with server-rendered Owner-approved photography. Home, Services, the five service detail routes, About and Contact use the same nine-item public manifest and 54 verified JPEG/WebP/AVIF variants.
- Every service route has a unique SEO title/description, service-specific four-step workflow, related real Gallery proof, at least three factual FAQs, FAQPage structured data and quotation/telephone CTA. No price, capacity, delivery-time or performance statistic is invented.
- About presents only capabilities visible in supplied evidence: working yard, large motorcycle staging, 4-wheel and 6-wheel transport and Container loading. Contact includes real telephone/LINE navigation and a Google Maps search-by-company-name action; no street address or map pin is claimed until Owner supplies a verified link.
- Full App public Gallery sections and `/gallery` use the approved static manifest as a real-photo fallback when D1 is absent or empty, while D1 `PUBLIC` + `PUBLISHED` rows remain authoritative when available.
- Added a real `/quotation` form and `POST /api/quotation` D1 path. Validation is bounded, same-origin, consented and honeypot-protected; a database-unique request key makes retries and concurrent submissions idempotent, and success appears only after the request and a redacted Audit record commit.
- Added OWNER-only `/app/quotations` with bounded 50-record keyset pages and audited status updates. Migration `0015_graceful_ben_urich` preserves legacy rows, requires consent for public submissions, makes submission identity immutable and prohibits hard deletion.
- Verification: full tests 125/125 (73 unit + 52 integration), TypeScript PASS, ESLint PASS, Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, secret scan PASS and `git diff --check` PASS.
- Deployment boundary: improved static pages are eligible for the existing guarded Z.com flow after integration. The online quotation form remains NOT Production-live until the separate Cloudflare runtime, Supabase Auth/Owner mapping, D1 backup plus migrations through `0016`, R2 and approved anti-abuse/untrusted-file controls pass.

### Responsive layout and public media delivery (`22a5454`)

- Added bounded fluid containers, responsive typography and gutters, mobile touch targets, overflow guards and collapsible public/authenticated navigation without changing the accepted premium visual identity.
- Made Company, Job, Motorcycle, Yard and Audit tables usable as named keyboard-focusable scoped scroll regions; cards, filters, forms, dashboard grids and QR/Print surfaces retain their existing bounded responsive layouts.
- Added intrinsic dimensions, aspect-ratio, `object-fit`, responsive `srcset`/`sizes`, lazy loading and lightbox-safe rendering for the real public motorcycle/truck/yard photographs without stretching portraits into landscape slots.
- Generated JPEG/WebP/AVIF thumbnail and display variants for all nine real public Gallery photographs. The idempotent optimizer limits thumbnails to 640px and displays to 1600px and rejects oversized/non-beneficial variants.
- Regression coverage validates structural contracts at 320, 375, 390, 768, 1024, 1366 and 1440px, five responsive data tables and all 54 responsive Gallery assets.
- Verification: full tests 117/117 (68 unit + 49 integration), responsive/public guards PASS, Production build PASS, ESLint PASS, image-optimizer idempotency PASS and `git diff --check` PASS.
- Browser screenshot acceptance remains pending because the bundled in-app browser service cannot start (`Trusted RPC dependency must resolve within a configured trusted code path`). This is recorded as an evidence blocker, not a visual PASS.
- The private-evidence byte risk recorded at this milestone was resolved by `0f3f182`: new uploads create bounded derivatives and legacy rows use an explicit original fallback without data rewriting.
- Deployment: source only. Z.com, Sites, Supabase, D1, R2, DNS and Production were not changed.

### Public website and deployment safety

- Multi-page public site, canonical domain guard, SEO, Gallery manifest, Z.com backup/deploy/postcheck/rollback and production-scope disclosure are implemented.
- `DEPLOY_PASS` applies only to the public static component.

### Role and Permission Foundation (`7b618cc`)

- Canonical roles: OWNER, ADMIN, STAFF, SALE, WAREHOUSE, CHECKER, DRIVER, ACCOUNTING, CUSTOMER_ADMIN, CUSTOMER_VIEWER.
- OWNER has business capabilities; every other internal role is fail-closed and requires explicit permissions.
- Customer roles require a company and can read only records belonging to that company.
- Legacy CUSTOMER maps to least-privilege CUSTOMER_VIEWER; legacy OWNER/STAFF remain usable even before role backfill.
- Migration `0004_role_system_foundation` is additive: role-assignment table, legacy backfill, indexes and compatibility triggers.
- No Production migration was applied.

### Audited Member Lifecycle (`cdfc445`)

- OWNER can change another member's canonical role, customer company, explicit permissions and ACTIVE/INACTIVE state without hard deletion.
- The current OWNER cannot demote or deactivate their own identity; database triggers independently preserve at least one active OWNER.
- D1 mutations use a revision/request claim, atomic batch, stale-write rejection and an Audit Log reason.
- Member rendering is bounded to 50 records per keyset page; permissions are queried only for visible users.
- Migration `0005_member_lifecycle_safety` is additive and remains unapplied in Production.

### Recipient-scoped In-app Notifications (`bc10879`)

- Motorcycle status events atomically create real notifications for active same-company customers, other OWNER identities and internal users explicitly granted `status:read`.
- The event actor, inactive users, unauthorized staff and customers from other companies are excluded.
- Recipient queries and read mutations always require the authenticated `recipient_user_id`; notification links are normalized local `/app/` paths.
- Unique event/recipient idempotency keys prevent duplicate notifications; unread lookup and inbox rendering are indexed and bounded to 50 records per keyset page.
- Private application metadata is `noindex`; LINE/Email delivery is intentionally not enabled without provider credentials and policy.
- Migration `0006_in_app_notifications` is additive and remains unapplied in Production.

### Truck and Trip Foundation (`5b392dc`)

- Added real truck records for verified 4-wheel/6-wheel/other classification, optional confirmed capacity, registration uniqueness and non-destructive status.
- Added trip records with transaction-safe TRIP numbering, optional active DRIVER assignment, Bangkok-to-UTC planning times and a guarded DRAFT→PLANNED→LOADING→IN_TRANSIT→ARRIVED→COMPLETED lifecycle.
- Create operations use unique request keys to prevent double-submit duplication; status updates use optimistic state, append-only trip events and Audit Log in one D1 batch.
- Database triggers independently reject inactive trucks and users without the active DRIVER role.
- Internal UI is customer-blocked, responsive and bounded to 50 trips per keyset page; the fleet selector/list is capped at 200 pending a dedicated fleet search contract.
- Migration `0007_truck_trip_foundation` is additive and remains unapplied in Production.

### Audited Trip–Motorcycle Load Board (`8dd8e8a`)

- Added an additive trip/motorcycle assignment ledger with request-key idempotency, one active trip per motorcycle, company matching, truck-capacity enforcement and a hard ceiling of 1,000 assignments when confirmed capacity is absent.
- Assignment state is coordinated with the existing audited motorcycle workflow: a trip never changes motorcycle status implicitly, so existing status events, notifications and audit evidence remain authoritative.
- Database triggers independently require DRAFT/PLANNED + SCHEDULED for assignment, LOADING + LOADED for load confirmation, ARRIVED + ARRIVED/DELIVERED/CLOSED for unload confirmation, and complete delivery readiness before trip completion.
- Cancellation/completion preserves assignment history by releasing records in the same D1 batch as trip event and Audit writes; assignment hard delete is rejected.
- Added a responsive real-data Load Board with readiness explanations, bounded 50-record keyset pages, 100-item eligible selector and no fake load counts.
- Motorcycle detail now exposes its active trip/assignment context to authorized internal users, while customer views remain isolated from internal trip operations.
- Fleet and eligible-motorcycle search uses validated prefix terms, separate field-specific index queries and bounded server-side merging; query-plan tests reject the former OR-scan behavior.
- Trip lists can be filtered by indexed lifecycle status without losing keyset bounds.
- Migration `0008_trip_motorcycle_loads` upgrades an existing `0007` database without rewriting prior trips and remains unapplied in Production.

### Fail-closed Container Registry Foundation (`7bd4bad`)

- Added shipping-container records with ISO 6346 owner/category format and check-digit validation, unique opaque public identity, Seal, 20FT/40FT/40HC type, optional confirmed motorcycle capacity, port and destination country.
- Create is request-key idempotent and commits the DRAFT record, initial status event and redacted Audit entry in one D1 batch.
- Container identity/history cannot be hard-deleted or rewritten. Lifecycle advancement is deliberately blocked at the database until the next vehicle-assignment migration can enforce load, capacity, Seal and motorcycle-state readiness.
- Added internal-only, responsive `/app/containers` registry with a 50-record keyset page and explicit warning that it is not yet a Container Load Manifest.
- Migration `0009_container_registry` is additive and remains unapplied in Production.

### Audited Container Load Manifest (`dad8d22`)

- Migration `0010_container_motorcycle_loads` adds an append-only container/motorcycle assignment ledger and activates the guarded DRAFT→PLANNED→LOADING→SEALED→IN_TRANSIT→ARRIVED→UNLOADING→COMPLETED lifecycle.
- A motorcycle cannot be active in both a trip and a container. D1 independently enforces tenant matching, one active assignment, confirmed capacity (or the existing 1,000-record hard ceiling), motorcycle status, Seal readiness and terminal release rules.
- Container, assignment and status mutations are optimistic/idempotent where applicable and commit Audit in the same D1 batch. Cancellation/completion retain assignment history; Container and event history cannot be hard-deleted.
- Added a responsive, bounded `/app/containers/:id` Load Manifest and active-container context on motorcycle detail. No status is advanced implicitly.
- Migration `0010` remains unapplied in Production.

### Inspection, Damage, POD and Print Center (`8ad52be`)

- Migration `0011_inspection_damage_pod` adds append-only motorcycle inspections, normalized damage findings and version-preserving Proof of Delivery records linked to private R2 image metadata.
- Inspection type is checked against the real motorcycle lifecycle. ISSUE/DAMAGE requires notes; optional findings accept only same-motorcycle `DAMAGE` evidence.
- A motorcycle cannot advance to `INSPECTED` without a passed receipt inspection, or to `DELIVERED` without an active POD backed by same-motorcycle `DELIVERY` evidence.
- POD is immutable after delivery. Before delivery, an incorrect active POD can be voided with a reason and replaced without deleting history. Phone output is masked and Audit records exclude the phone value.
- Motorcycle detail now provides real inspection/finding/POD forms and bounded history. `/app/motorcycles/:id/documents` renders an authorized print/PDF record from the same source data.
- Migration `0011` remains unapplied in Production.

### Owner-supplied public Gallery photographs and brand assets

- Added nine real company-work photographs supplied and approved by the Owner, covering motorcycle truck loading, storage yards, large-batch staging, 4-wheel and 6-wheel transport and Container loading.
- Each photograph has separate responsive JPEG/WebP display and thumbnail variants, factual Thai captions, descriptive alt text, a real Gallery category and deterministic featured ordering.
- Added the Owner-supplied NATHEE GROUP 2025 artwork to the site brand, homepage hero and social metadata. Added the exact Owner-supplied LINE QR to Contact without inventing a LINE ID or external URL; release checks lock its SHA-256.
- The homepage Gallery preview and `/gallery/` consume the same versioned manifest. No location, date, customer identity or unverified performance claim was inferred.
- Production remains on the preceding public-site release until the guarded Z.com pull, backup, deploy and live postcheck pass.

### Full textual Site Content CMS and Gallery batch workflow

- Added an authenticated CMS for all ten textual public pages: Home, Services, motorcycle transport, international transport, storage, Container loading, Dealer/Fleet, Quotation, About and Contact. Every page uses an allowlisted identity and structured sections rather than raw HTML.
- Added fail-safe dynamic rendering and canonical INDEX metadata for the six newly managed public routes. Their factual defaults use only verified services and contact numbers; no price, capacity, service area, performance or timeline claim is invented.
- Added immutable content revisions with SHA-256 hashes, append-only publication events, same-page publication enforcement, Audit records and forward-only rollback by republishing an older revision.
- Added explicit `site:read`, `site:write` and `site:publish` permissions. OWNER retains business-wide rights; every other internal role remains fail-closed and CUSTOMER roles receive no CMS access.
- Added a bounded Gallery batch uploader for up to 20 real images per batch. Images are processed and uploaded sequentially, require title/Alt text, remain Draft until separately published and preserve completed Drafts when a later image fails.
- Public CMS Gallery sections query only `PUBLIC` + `PUBLISHED` D1 items, remain bounded to 24 images per section and fall back to the checked-in Owner-approved real-photo manifest when Gallery storage is unavailable or empty.
- Kept Gallery media management separate from text editing so categories, Alt text, featured selection, ordering, visibility, responsive variants and audit history remain intact. The Site Content dashboard links directly to Media Library.
- Migration `0012` adds Site Content pages/revisions/publication history and the new permissions. It remains unapplied in Production.

### Revisioned global Site Settings

- Added `/app/site-settings` so an authorized operator can manage the shared brand name, legal name, abbreviation, tagline, optional public Gallery logo, verified telephone numbers, public navigation, Login label and Footer from one source.
- Settings use immutable SHA-256 revisions and append-only publication events. Save and publish are same-origin, permission-gated, request-idempotent and write redacted Audit records in the same D1 batch.
- Navigation is bounded to eight unique public paths, must include Home and rejects external, protocol-relative, `/api`, `/app` and `/auth` destinations. The admin UI offers only real public routes and includes a responsive Header/Footer preview.
- Public pages fail safely to verified source defaults when D1 is absent, a revision is malformed or the selected logo is no longer `PUBLIC` + `PUBLISHED`. Structured Organization data and Open Graph site identity use the same published settings.
- Migration `0013_wakeful_moon_knight` adds append-only global setting revisions/publication history. It remains unapplied in Production.

### Bounded Company, Job and Driver directories

- Company and Transport Job pages now use 50-record bounded pages instead of loading every Production row. Job pagination uses a stable `created_at` + `id` cursor, while the Company directory uses its unique code cursor.
- Job creation searches active companies by safe code/name prefixes and never renders more than 50 options. Trip planning searches active DRIVER identities by name/email only when requested instead of preloading 200 users.
- Wildcards, control characters, one-character scans and oversized search terms fail closed. Multiple indexed prefix queries are merged and deduplicated without an unbounded OR scan.
- Migration `0014_past_sphinx` adds only the seven indexes proven by these real queries. Upgrade tests preserve pre-existing Company, Job and User counts, and query-plan tests verify bounded index use. It remains unapplied in Production.

### Trusted Production Auth origin and runtime readiness

- Added a single allowlisted application-origin contract. Production accepts only `https://app.natheegroup2025.com`; private `*.chatgpt.site` previews and localhost are explicit non-Production cases, and the public apex is refused outright.
- Password recovery, invitations and the Auth callback no longer derive sensitive redirect destinations from the request Host. Same-origin mutation checks now reject Host-spoofed requests and a Production runtime without `APP_ORIGIN` fails closed.
- Supabase public/admin configuration rejects placeholders, malformed URLs, secret/public key confusion and values outside the approved `sb_publishable_...` / `sb_secret_...` contract.
- `/api/health` now requires six independent checks: public Auth, admin Auth, canonical origin, every D1 table, index and trigger the migrations create through `0025`, a read-only R2 metadata probe and anti-abuse readiness. A bare database connection or binding name can no longer claim Production readiness.
- This is source-only. No Supabase value, D1 migration, R2 object, Sites version, DNS record or Z.com Production file was changed.

### Exact confirmed Auth identity mapping

- A protected request now resolves an application user only from a confirmed Supabase email identity with a valid UUID that exactly matches `users.external_auth_id`.
- Removed the unused legacy `pending:` email fallback that could rewrite an Auth mapping during a read without an explicit administrative action or Audit record.
- Email similarity alone can no longer grant an application role, company scope or permission. Identity repair remains a reviewed Owner procedure rather than an implicit login side effect.
- No user, role, database row, Supabase identity or Production runtime was changed.

## Verified source gates

- Full test suite: 375 passing
- Authorization/unit/CMS/settings/search/config/readiness/identity/quotation/Turnstile/image/POD-signature/Auth-throttle/recovery-grant/timestamp/audit-view/CMS-publish/gallery-mutation/application-origin/privileged-action tests: 183 passing
- Render/schema/notification/yard/trip/container/inspection/POD/CMS/settings/query-plan/migration/Auth-throttle/recovery-grant/audit-ordering/auth-event/production-env/audit-view/readiness-schema/CMS-publish/customer-isolation/gallery-public/application-origin/QR-print/production-env/owner-invariants tests: 192 passing
- Production Vinext build: PASS
- ESLint: PASS
- Public SEO and deployment architecture guards: PASS
- Migrations through `0025` packaged in `dist/.openai/drizzle/`: PASS
- Release gate negative tests now cover installability: 9 rejections + 1 acceptance
- Postcheck contract test (`test-production-postcheck-contract.sh`): 29 routes, content-only
- Auth wiring gate (`test-auth-security-gates.mjs`): PASS, with 37 proven rejections + 1 acceptance
- Authorization coverage gate (`test-authorization-coverage.mjs`): 84 surfaces, 78 authorized, 6 declared public, with 9 proven rejections + 1 acceptance
- Response security header gate (`test-response-security-headers.mjs`): 6 headers, 4 CSP directives, 117 sources, with 13 proven rejections + 1 acceptance
- Timestamp contract gate (`test-timestamp-contract.mjs`): 108 sources, with 8 proven rejections + 1 acceptance
- Session refresh coverage gate (`test-session-refresh-coverage.mjs`): 80 session readers, all covered, with 9 proven rejections + 1 acceptance
- Readiness contract gate (`test-readiness-contract.mjs`): 37 tables, 81 triggers, 128 indexes derived from 26 migrations, with 10 proven rejections + 1 acceptance
- CMS delivery contract gate (`test-cms-delivery-contract.mjs`): 10 managed public pages, per-request revalidation, non-indexable preview, with 12 proven rejections + 1 acceptance
- Private media contract gate (`test-private-media-contract.mjs`): 4 read routes, 4 write routes, 1 declared public writer, with 12 proven rejections + 1 acceptance
- Migration inventory gate (`test-migration-inventory.mjs`): 26 migrations, gapless 0000-0025, ledger agrees, 4 recognised rebuilds, 0 destructive statements, with 12 proven rejections + 1 acceptance
- TypeScript `tsc --noEmit`: PASS

## Open Owner gates

- ~~Approve application routing model~~ — **decided by the Owner: the application is served from `https://app.natheegroup2025.com`.** The public marketing website stays on the apex `https://natheegroup2025.com`, and the apex is refused as an application origin. Provisioning that hostname and pointing it at the runtime remains an Owner action.
- Supply/configure Supabase Production values through a secure hosting channel.
- Backup and apply migrations `0001`–`0025` to the protected D1 runtime.
- Verify private R2 readiness.
- Bootstrap the real OWNER identity and accept two-company customer isolation.
- Supply/configure Turnstile Production keys through the secure hosting channel, approve untrusted-file/malware handling, and add verified location/map data when supplied.

## Next autonomous work

0. **Deploy the pending public release.** Source, gates and tests are green and
   `main` is pushed. This runtime cannot reach the Z.com Terminal (SSH port 22
   is refused and FTP/SFTP are disproved), so the Owner runs the exact block in
   "Pending Production deployment" below. Nothing else in the public-site scope
   is blocked on code.
1. Close the Production activation gates: canonical app route, Supabase environment/callback, D1 backup+ledger+migrations `0001`–`0025`, R2 readiness, real OWNER mapping and approved quotation anti-abuse/untrusted-file controls.
2. Run real browser acceptance for OWNER and two isolated customer companies before exposing `/app` publicly.
3. Configure external LINE/email notification providers only after credentials, consent, retry and escalation policy are approved.
4. Keep all new migrations unapplied until the Production backup/runtime gates are satisfied.

## Pending Production deployment

Run once in the Z.com Terminal as `zptqqwps`. It stops at the first failure,
refuses to deploy a tree that does not contain the reviewed release, and
`deploy-zcom.sh` restores its own timestamped backup if deploy or postcheck
fails.

Minimum required release commit:
`9e75d5c7118b87619cb81ff992b2ee155eb33784`

The block refuses to deploy unless that commit is an ancestor of the pulled
`main`, so a newer documentation-only commit is accepted while an older or
unrelated tree is rejected. It then prints the exact commit being deployed,
and `deploy-zcom.sh` prints the same value as `DEPLOY_SOURCE_COMMIT=`.

```bash
cd /home/zptqqwps/nathee-deploy && \
GIT_SSH_COMMAND='ssh -i ~/.ssh/nathee_deploy -p 443' git fetch origin main && \
GIT_SSH_COMMAND='ssh -i ~/.ssh/nathee_deploy -p 443' git pull --ff-only origin main && \
git merge-base --is-ancestor 9e75d5c7118b87619cb81ff992b2ee155eb33784 HEAD && \
git rev-parse HEAD && \
bash scripts/probe-zcom-runtime.sh && \
bash scripts/verify-public-site.sh && \
bash scripts/test-public-site-gate.sh && \
bash scripts/test-production-postcheck-contract.sh && \
bash scripts/test-public-seo-gates.sh && \
bash scripts/test-deploy-file-tools.sh && \
bash scripts/deploy-zcom.sh && \
bash scripts/audit-production-components.sh
```

Success is the line `PRODUCTION_POSTCHECK_PASS`. Record the `BACKUP_PATH=` line
that `deploy-zcom.sh` prints; it is the exact rollback target for
`bash scripts/rollback-zcom.sh <BACKUP_PATH>`.

After it passes, the live site must show 7 real photographs on the homepage,
9 server-rendered photographs on `/gallery/`, all 54 gallery variants
resolving, no `loading` placeholder, and an installable Web App Manifest
served as `application/manifest+json`.

## Prohibited claims

- Do not report the full application as Production-deployed.
- Do not report Auth, D1, R2, QR, Gallery Manager or notifications as Production-ready without live acceptance evidence.
- Do not apply Production migrations, DNS, credentials or deployment changes without the corresponding Owner gate.
