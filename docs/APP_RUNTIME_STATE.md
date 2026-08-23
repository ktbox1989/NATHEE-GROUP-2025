# Application runtime state — measured, not assumed

Measured from this worktree at `2026-08-23T04:34Z` against live DNS and the live
network. Nothing here was changed; every command below is read-only.

## Headline: there is no 502, because there is no hostname

The task that opened this lane described a **502** at
`https://app.natheegroup2025.com`. That is not what is happening, and the
difference matters: a 502 means the name resolved and something upstream
answered badly, which would point at the runtime. What is actually happening is
that **the name does not resolve at all**.

Three independent observations agree:

| Check | Result |
| --- | --- |
| `curl https://app.natheegroup2025.com/` | `Could not resolve host` |
| `nslookup app.natheegroup2025.com` (local resolver `192.168.1.1`) | `Non-existent domain` |
| `nslookup app.natheegroup2025.com 8.8.8.8` (Google public DNS) | `Non-existent domain` |
| `bash scripts/verify-app-integration.sh` | `/api/health was unreachable` |

The network and the resolver are working — the control checks below succeed from
the same shell in the same minute — so this is not a sandbox limitation.

## What does resolve

| Host | Result |
| --- | --- |
| `natheegroup2025.com` | `A 118.27.146.25` — public site **LIVE, HTTP 200** |
| `www.natheegroup2025.com` | `A 118.27.146.25` — same host |
| `app.natheegroup2025.com` | **NXDOMAIN** |
| `api.natheegroup2025.com` | NXDOMAIN |
| `admin.natheegroup2025.com` | NXDOMAIN |

## The zone is on Z.com nameservers, not Cloudflare

```text
natheegroup2025.com  nameserver = ns-a1.cloud.z.com
natheegroup2025.com  nameserver = ns-a3.cloud.z.com
natheegroup2025.com  nameserver = ns-a4.cloud.z.com
```

This is the fact that decides how the application is reached, and it is worth
stating plainly because the brief assumed a Cloudflare binding:

- The **public website** is served from Z.com shared hosting at `118.27.146.25`,
  which is exactly what `docs/DEPLOYMENT_ARCHITECTURE.md` describes and what the
  CLOSED/PASS public Production state refers to.
- The **application** is a Cloudflare-compatible Sites artifact
  (`.openai/hosting.json` → `project_id: appgprj_…`, bindings `DB` and `FILES`).
  Z.com shared hosting cannot run it: it provides no D1 and no R2, and the
  deployment architecture already forbids copying the worker or the app tree into
  `public_html`.
- For `app.natheegroup2025.com` to serve the application, a record must be
  created **on the Z.com nameservers** pointing at the Sites runtime, and that
  runtime must accept the custom hostname and hold a certificate for it.

There is no code change that can produce that record. It is a DNS and TLS
action, which is an Owner Gate.

## Where the reported 502 may have come from

Recorded as an open question rather than guessed at, because the answer changes
what to do next:

- a Sites or Cloudflare dashboard preview panel showing a 502 for a custom domain
  whose origin is not yet bound;
- a browser or corporate resolver with a stale or wildcard entry;
- a different hostname — for example the artifact's own `*.chatgpt.site` preview,
  which is owner-only and not reachable from here.

**Requested from the Owner:** where the 502 was observed (URL, and whether in a
browser, a dashboard, or a terminal). If it was a dashboard, the runtime may
already exist and only the DNS record is missing, which is a shorter path than a
runtime that is failing.

## What is verified ready on the source side

Measured on `production-readiness` at
`74d88b4e5e7024d187712ae803417b743e9332a2`, which is `origin/main`:

- 471 tests passing (279 unit + 192 integration), 0 failures
- TypeScript PASS, ESLint PASS, Vinext production build PASS
- Every readiness, authorization, auth, CMS, private-media, migration and
  line-ending gate PASS
- Migrations `0000`–`0025`: gapless, ledger agrees, 0 destructive statements,
  **all unapplied to Production**
- Schema contract derived from the migrations: 37 tables, 81 triggers, 128
  indexes

The application is ready to be deployed. Nothing about it is ready to be
*claimed*, because none of it has answered on a live authenticated origin.

## Blockers, exactly

1. **DNS.** No record exists for `app.natheegroup2025.com` on the Z.com
   nameservers. Owner action.
2. **TLS.** A certificate covering that hostname, issued by whatever terminates
   it. Owner action.
3. **Runtime binding.** The Sites artifact must be published and bound to the
   custom hostname. Owner action; the artifact and its bindings are declared in
   `.openai/hosting.json` and verified by `npm run verify:env`.

Until 1–3 exist, `/api/health` cannot be reached, and therefore **no live check
in `docs/OWNER_GATE_CHECKLIST.md` Gate 7 or Gate 8 can be attempted**.
`APP_RUNTIME_PASS` remains NOT_PROVEN, and no local test can change that.

## Acceptance is now one command, waiting on those three

The moment the hostname resolves and the runtime answers, Gates 7 and 8 are a
single run:

```bash
npm run verify:acceptance
```

Measured today against the real origin, it reports what is actually true:

```text
FAIL [unauthenticated] reachable: https://app.natheegroup2025.com could not be reached: fetch failed
SKIP [authenticated] owner-login: NATHEE_OWNER_EMAIL / NATHEE_OWNER_PASSWORD not supplied
...
APP_RUNTIME_FAIL passed=0 failed=1 skipped=6 (reachable)
```

The design point is what it does *not* do. A check that could not run is
reported `SKIP` and forces `APP_RUNTIME_INCOMPLETE`, never a pass; the pass token
is not printed by the failing or incomplete verdicts, so searching a log for it
cannot produce a false hit; and customer isolation is only claimed when two
accounts in two different companies actually hold distinguishable records.

It covers what the Owner defined APP_RUNTIME_PASS to mean: readiness, the login
form and callback, the OWNER reaching the application, customer isolation across
two companies, QR and the print centre, the Audit trail recording the sign-in,
the recovery form refusing to reveal who has an account, a sign-out that stops
answering the old cookie, and the CMS Draft to Preview to Publish loop reaching
the public page with no
redeploy. Publishing is opted into separately and restores the revision that was
live before, because it changes what visitors see.

That it can genuinely reject a broken runtime is tested rather than asserted:
`scripts/test-production-acceptance-rejections.mjs` serves a real HTTPS
impersonation of the application and breaks it 32 ways, requiring the runner to
catch each, plus six ways it could lie by omission. It runs in
`npm run test:security` as `ACCEPTANCE_NEGATIVE_PASS`.

So the remaining distance to `APP_RUNTIME_PASS` is exactly the three Owner
actions above, plus supplying an OWNER and two customer accounts at run time.
Nothing further is waiting on source work.
