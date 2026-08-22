# Lane B → Lane A integration handoff

Prepared instead of merging. Nothing in this document has been merged, pushed to
`main`, or applied to Production.

- Lane B branch: `lane-b/auth-runtime`
- Lane B HEAD: `36717aecfa7f00a8d941a00ec60293d6a82ab941`
- Merge base with `main`: `0f3205b432cd2aba2fb499b8b7d76fe3e6d25716`
- Lane A `main` at analysis time: `386e01c`

## Merge status, measured not assumed

`git merge-tree --write-tree origin/main HEAD` (read-only; it computes a merge
without touching any branch or working tree) reports:

| File | Result |
| --- | --- |
| `package.json` | **CONFLICT** — both lanes edited the same script strings |
| `PROJECT_CURRENT_STATE.md` | **CONFLICT** — both lanes appended milestone sections |
| `docs/PRODUCTION_GO_LIVE.md` | auto-merges cleanly |
| everything else | auto-merges cleanly |

No source file conflicts. Lane B touched no file under `public-site/`, no
`scripts/build-public-site.mjs`, no `scripts/deploy-zcom.sh`, and no public page
component.

## Resolving `package.json`

The conflict is mechanical: both lanes added entries to the same lists. **Union,
nothing dropped.**

Scripts only Lane A has — keep as they are:

- `audit:live` → `node scripts/audit-live-public-site.mjs`
- `login:redirect` → `node scripts/set-login-redirect.mjs`

Scripts only Lane B has — add:

- `verify:env` → `node scripts/verify-production-env.mjs`
- `test:security` → the twelve gate scripts listed under "Gates Lane B added"

Scripts both lanes changed:

- **`test:unit`** — union of test files. Lane A added
  `tests/customer-isolation.test.ts`; Lane B added `tests/timestamps.test.ts`,
  `tests/audit-view.test.ts`, `tests/auth-throttle.test.ts`,
  `tests/auth-recovery-grant.test.ts`, `tests/site-cms-publish.test.ts`.

Scripts only one lane changed — take that lane's version:

- **`test:gate`** — Lane A only (adds `test-app-readiness.sh`,
  `test-login-redirect.sh`).
- **`test:db`** — Lane B only (adds seven migration/DB test files).
- **`test`** — Lane B only (inserts `npm run test:security` and appends the same
  seven files).

## Resolving `PROJECT_CURRENT_STATE.md`

Both lanes append to "Closed local milestones" and edit "Verified source gates".
Keep **both** lanes' milestone sections. For the counts, Lane B's measured
numbers after this branch are:

- Full test suite: **311** passing — 164 unit + 147 integration
- Migrations: through **`0025`**, all unapplied
- Gates: see below

Those counts do **not** include Lane A's `tests/customer-isolation.test.ts` or
its gate scripts. After merging, re-run `npm test` and write the combined figure
rather than adding the two lanes' numbers together.

## What Lane B changed that Lane A depends on

**`/api/health` payload is unchanged.** `RuntimeChecks` still reports exactly
`authentication`, `adminAuthentication`, `canonicalOrigin`, `database`,
`storage`, `antiAbuse`, so `scripts/lib/app-readiness.sh` and its
`NATHEE_HEALTH_CHECKS` list stay correct as written. Only the internals changed:
the probe now reads the schema catalogue in one parameterless statement instead
of binding one parameter per required object, because the contract grew past
D1's parameter ceiling.

**`database: true` is now much stricter.** It requires every object the
migrations create — 37 tables, 81 triggers, 128 indexes — where it previously
required a hand-picked 63. A runtime that reported `database: true` under the old
contract may report `false` under this one. That is the intended correction: 48
safety triggers, including the last-active-OWNER protection and the role/company
compatibility checks, were not being verified at all.

**The static public `/login/` placeholder is untouched.** Lane B changed
`app/login/page.tsx` (the application route), which
`scripts/test-deployment-architecture.mjs` does not read. Lane A's
`login:redirect` work and Lane B's login route do not overlap.

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

Each runs in `npm run test:security`, and each has a negative test that proves it
rejects specific breakages rather than passing vacuously.

| Gate | Proves | Rejections |
| --- | --- | --- |
| `test-readiness-contract.mjs` | readiness requires every migrated object | 10 |
| `test-session-refresh-coverage.mjs` | every session reader is behind the proxy | 9 |
| `test-auth-security-gates.mjs` | Auth wiring: budgets, proof, event trail | 30 |
| `test-authorization-coverage.mjs` | every protected surface authorizes | 9 |
| `test-response-security-headers.mjs` | headers ship and the app stays compatible | 13 |
| `test-timestamp-contract.mjs` | one timestamp representation per column kind | 8 |

## Still Owner-gated — unchanged by this branch

Supabase Production values, D1 backup + migrations `0001`–`0025`, R2 readiness,
the application routing model, the real OWNER bootstrap, and Turnstile keys.
`npm run verify:env` now checks the first of those before a deploy, without
contacting any provider and without printing any value.

**No Production acceptance is claimed.** `login-auth` and `full-application`
remain as they were; nothing here is evidence that authenticated login, customer
isolation or the runtime checks pass on Production.
