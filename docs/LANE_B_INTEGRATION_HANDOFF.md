# Lane B → Lane A integration handoff

Prepared instead of merging. Nothing in this document has been merged, pushed to
`main`, or applied to Production.

- Lane B branch: `lane-b/auth-runtime`
- Lane B HEAD: see `git rev-parse HEAD` on `lane-b/auth-runtime` (this document is updated per milestone)
- Merge base with `main`: `0f3205b432cd2aba2fb499b8b7d76fe3e6d25716`
- Lane A `main` at analysis time: `1f3b9c4`

## Merge status, measured not assumed

`git merge-tree --write-tree origin/main HEAD` — read-only; it computes a merge
without touching any branch or working tree:

| File | Result |
| --- | --- |
| `package.json` | **CONFLICT** — both lanes edited the same script strings |
| `PROJECT_CURRENT_STATE.md` | **CONFLICT** — both lanes appended milestone sections |
| `docs/PRODUCTION_GO_LIVE.md` | auto-merges cleanly |
| everything else | auto-merges cleanly |

No source file conflicts. Lane B touched nothing under `public-site/`, no
`scripts/build-public-site.mjs`, no `scripts/deploy-zcom.sh`, and no public page
component — but it did change one Lane A file, `scripts/test-canonical-domain.mjs`,
for the reason given below.

## The merged tree was actually tested, not just diffed

The merged tree was materialised into a scratch directory and every Lane B gate
run against it. All seven pass. That check found one real defect — in Lane B's
own gate, not in the merge:

`scripts/test-response-security-headers.mjs` asserted a header using a literal
newline, so it depended on how the tree was checked out. It passed on this
LF working copy and **failed on the CRLF tree that a Windows checkout produces** —
which is what the Owner and Lane A actually have. Fixed by normalising line
endings on read; the gate now passes on both, and its thirteen rejection cases
still reject. Without the dry-run this would have surfaced as a broken build on
someone else's machine.

## Resolving `package.json`

Mechanical: both lanes added entries to the same lists. **Union, nothing
dropped.**

Scripts only Lane A has — keep: `audit:live`, `login:redirect`, plus whatever
`1f3b9c4` added for the public CMS contract.

Scripts only Lane B has — add: `verify:env`, and `test:security` (fourteen gate
scripts).

Both lanes changed:

- **`test:unit`** — union of test files. Lane A added
  `tests/customer-isolation.test.ts` and its `public-cms-*` / `public-quotation-*`
  tests; Lane B added `tests/timestamps.test.ts`, `tests/audit-view.test.ts`,
  `tests/auth-throttle.test.ts`, `tests/auth-recovery-grant.test.ts`,
  `tests/site-cms-publish.test.ts`, `tests/gallery-mutation.test.ts`.

One lane only — take that lane's version:

- **`test:gate`** — Lane A only.
- **`test:db`**, **`test`** — Lane B only.

## Resolving `PROJECT_CURRENT_STATE.md`

Both lanes append to "Closed local milestones" and edit "Verified source gates".
Keep **both** lanes' sections. Lane B's measured figures after this branch:

- Full test suite: **344** passing — 177 unit + 167 integration
- Migrations: through **`0025`**, all unapplied
- Gates: seven, listed below

These exclude Lane A's tests entirely. After merging, re-run `npm test` and
record the combined figure rather than adding the two lanes' numbers.

## The two lanes' CMS work is complementary — and one decision is open

Lane A added `lib/public-cms/{contract,media,preview,revalidation,seo,source}.ts`.
This does not collide with Lane B's CMS work; the two describe different delivery
paths, and Lane A's own comment states the split: *"Lane B owns who may request a
preview. This file owns what the public site will accept and how it must
respond."*

- **Lane B** governs the application: who may edit and publish, what a publish
  verifies before it ships, and how the application's own public routes resolve
  content.
- **Lane A** governs the static public site: how it would consume CMS output,
  which cached paths a publish invalidates, and how a public-origin preview
  would be admitted.

Two differences the Owner should decide on rather than have decided for them:

1. **Preview surface.** Lane B's preview is a route *inside* the authenticated
   application, so unpublished content never appears at a public origin at all.
   Lane A's is a public-origin preview protected by an unguessable expiring
   token. Both can exist, but the second is strictly more exposure than the
   first, and it is only needed if previews must be shareable with people who
   have no application account.
2. **Revalidation.** Lane B's public routes are per-request, so there is no cache
   to invalidate. Lane A's static site is cached, so a publish must compute
   invalidation paths. Both are correct for their own surface. With the routing
   model now decided — the application on `app.natheegroup2025.com`, the public
   site on the apex — **both are live at once**, each governing its own origin.
   Lane A's invalidation planning applies to the Z.com static site; Lane B's
   per-request resolution applies to the application.

Neither difference blocks the merge.

## Lane A file changed — needs review before merge

`scripts/test-canonical-domain.mjs` is Lane A's gate, and Lane B changed it. It
is the only Lane A file this branch touches, and it could not be avoided.

The Owner corrected the application origin to `https://app.natheegroup2025.com`,
with the public website staying on the apex. That gate hard-coded the **apex**
Auth callback as a required contract in `docs/AUTH_SETUP.md`,
`docs/PRODUCTION_GO_LIVE.md` and `.env.example`, so applying the correction
without touching it would have failed `npm run test:public`.

Rather than retarget it, the gate now encodes the two-origin reality:

- public-site contracts (`public-site/*`, `deploy-zcom.sh`, `rollback-zcom.sh`,
  `postcheck-production.sh`, `build-public-site.mjs`) still require the apex —
  **unchanged**;
- the three application files require `https://app.natheegroup2025.com/auth/callback`;
- a new check refuses a regression that puts `APP_ORIGIN` or the Supabase Site
  URL back on the apex;
- the pass line now reports both origins.

Everything else Lane A owns is untouched: nothing under `public-site/`, no
deploy or verify script, no public page component. Please review this one file.

## The application origin changed

`APP_ORIGIN` is now `https://app.natheegroup2025.com`, and the apex is
**refused** rather than discouraged — it is the most plausible wrong value, and
the application must not share an origin with a document root that
`deploy-zcom.sh` overwrites by file copy.

What this does **not** change: the public SEO canonicals. `lib/cms-public-route.ts`,
`lib/site-structured-data.ts` and the public page metadata still point at the
apex, because the public site remains the canonical copy of that content. If the
application ever serves those pages at its own origin they will still canonicalise
to the apex, which is the correct outcome.

## What Lane B changed that Lane A depends on

**`/api/health` payload is unchanged** — the same six check names
`scripts/lib/app-readiness.sh` greps for, so that file stays correct as written.
Only the probe internals changed: it reads the schema catalogue in one
parameterless statement rather than binding one parameter per required object,
because the contract grew past D1's parameter ceiling.

**`database: true` is now much stricter.** It requires every object the
migrations create — 37 tables, 81 triggers, 128 indexes — where it previously
required a hand-picked 63. A runtime that reported `database: true` under the old
contract may report `false` under this one. That is the intended correction: 48
safety triggers, including the last-active-OWNER protection and the role/company
compatibility checks, were not being verified at all. Expect it rather than read
it as a regression.

**The static public `/login/` placeholder is untouched.** Lane B changed
`app/login/page.tsx`, the application route, which
`scripts/test-deployment-architecture.mjs` does not read.

## Migrations Lane B added — all additive, all unapplied

| Migration | Adds |
| --- | --- |
| `0022_auth_attempt_throttle` | `auth_attempt_counters` table + index |
| `0023_auth_recovery_grants` | `auth_recovery_grants` table + 2 indexes |
| `0024_audit_trail_immutability` | `audit_logs` no-update / no-delete triggers |
| `0025_audit_action_index` | `idx_audit_logs_action_created` |

None changes an existing table, row, trigger or constraint. The Production
deployment block's migration range moves from `0001`–`0021` to `0001`–`0025`.

## Gates Lane B added

Each runs in `npm run test:security`; each has a negative test proving it rejects
specific breakages rather than passing vacuously.

| Gate | Proves | Rejections |
| --- | --- | --- |
| `test-readiness-contract.mjs` | readiness requires every migrated object | 10 |
| `test-session-refresh-coverage.mjs` | every session reader is behind the proxy | 9 |
| `test-auth-security-gates.mjs` | Auth wiring: budgets, proof, event trail | 30 |
| `test-authorization-coverage.mjs` | every protected surface authorizes | 9 |
| `test-response-security-headers.mjs` | headers ship and the app stays compatible | 13 |
| `test-timestamp-contract.mjs` | one timestamp representation per column kind | 8 |
| `test-cms-delivery-contract.mjs` | publish takes effect; preview stays private | 12 |

## Still Owner-gated — unchanged by this branch

Supabase Production values, D1 backup + migrations `0001`–`0025`, R2 readiness,
the application routing model, the real OWNER bootstrap, and Turnstile keys.
`npm run verify:env` checks the first of those before a deploy, without
contacting any provider and without printing any value.

**No Production acceptance is claimed.** `login-auth` and `full-application`
remain as they were; nothing here is evidence that authenticated login, customer
isolation or the runtime checks pass on Production.
