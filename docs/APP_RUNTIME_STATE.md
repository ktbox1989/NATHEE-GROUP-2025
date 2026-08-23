# Application runtime state — measured, not assumed

Measured from this worktree at `2026-08-23T05:30Z` against live DNS and the live
network, re-run after the Owner identified the source of the 502. Nothing here
was changed; every command below is read-only.

## Headline: the 502 is real, and it is not the application

The 502 was observed by an external web fetcher, not in a Cloudflare or Sites
dashboard, not on the Z.com terminal, and not by the Owner in a browser. That
detail settles it.

A fetch proxy that cannot resolve or connect to an upstream reports **502 Bad
Gateway** about its own upstream connection. The status describes the proxy, not
an origin server, and it is returned whether the name is missing, the host is
unreachable, or the runtime is broken. So the 502 is consistent with the DNS
evidence and adds nothing to it. It was never evidence of a runtime.

**Authoritative DNS is the source of truth here, and it says the record does not
exist.** Measured this run, with a control on every resolver:

| Probe | `app.natheegroup2025.com` | `natheegroup2025.com` (control) |
| --- | --- | --- |
| `ns-a1.cloud.z.com` (authoritative) | **no A, no CNAME** | `A 118.27.146.25` |
| `ns-a3.cloud.z.com` (authoritative) | **no A, no CNAME** | `A 118.27.146.25` |
| `ns-a4.cloud.z.com` (authoritative) | **no A, no CNAME** | `A 118.27.146.25` |
| `8.8.8.8` | NXDOMAIN | `A 118.27.146.25` |
| `1.1.1.1` | NXDOMAIN | `A 118.27.146.25` |
| `9.9.9.9` | NXDOMAIN | `A 118.27.146.25` |
| `208.67.222.222` | NXDOMAIN | `A 118.27.146.25` |

Every resolver answered the control in the same run, so this is an absent record
rather than a broken probe or a blocked network.

## The blocker, stated exactly

**The `app.natheegroup2025.com` DNS / custom-domain record is not proven to
exist publicly.** Nothing about the application runtime may be diagnosed until
that changes.

## The order that has to be followed

```text
authoritative DNS → public resolvers → TLS → HTTP → runtime
```

`npm run verify:hostname` walks exactly that ladder and refuses to skip a rung:
TLS is not attempted until the name resolves consistently, and HTTP is not
attempted until TLS completes, so the run cannot produce a status that invites a
conclusion the DNS evidence does not support. Today it reports:

```text
APP_HOSTNAME_DNS_MISSING app.natheegroup2025.com has no record on any authoritative nameserver for the zone
runtimeDiagnosable=false
```

Only once the hostname resolves consistently **and** terminates TLS does a 5xx
become attributable to the application, at which point the same command reports
`APP_HOSTNAME_RUNTIME_FAILING` with `runtimeDiagnosable=true`. That rule is
enforced in `lib/hostname-diagnosis.ts` and swept in
`tests/hostname-diagnosis.test.ts`: for every incomplete rung, every HTTP status
from 200 to 504 must stay non-diagnosable. The misdiagnosis cannot recur
silently.

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

## Where the 502 came from

Answered by the Owner: it came from an external web fetcher, not from a
dashboard, terminal or browser. An independent external fetch still returns 502
while authoritative DNS returns NXDOMAIN, and those two facts do not conflict
for the reason given at the top of this document.

The practical consequence is that the shorter path is the one in play: there is
no evidence of a failing runtime to chase, and the work is to create the record
and bind the hostname.

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
   nameservers, confirmed at the authoritative servers and at four public
   resolvers, each with a control. Owner action. Verify with
   `npm run verify:hostname`.
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
