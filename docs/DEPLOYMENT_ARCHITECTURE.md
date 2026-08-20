# NATHEE Production deployment architecture

This document separates source completeness from verified Production runtime.
A successful Z.com public-site deployment is never evidence that the protected
application, API, database, storage or authentication is deployed.

## Verified Production state (2026-08-21)

| Component | Repository source | Verified Production path / URL | Status |
| --- | --- | --- | --- |
| Public static website | `public-site/` | `/home/zptqqwps/public_html/natheegroup2025.com` / `https://natheegroup2025.com/` | `PUBLIC_STATIC_LIVE` |
| Public Gallery | `public-site/gallery/`, `public-site/assets/gallery.json` | `/home/zptqqwps/public_html/natheegroup2025.com/gallery` / `https://natheegroup2025.com/gallery/` | Live static manifest; zero published real photographs at audit time |
| Login/Auth frontend | `app/login/`, `app/api/auth/`, `app/auth/callback/` | No accepted canonical runtime. `https://natheegroup2025.com/login/` is only a noindex status page. | `LOGIN_STATIC_PLACEHOLDER` |
| OWNER/STAFF/CUSTOMER application | `app/app/`, `app/portal/` | No accepted canonical runtime; `https://natheegroup2025.com/app` returned 404 | `FULL_APPLICATION_NOT_DEPLOYED` |
| Backend/API | `app/api/`, `worker/` | No accepted canonical runtime; `https://natheegroup2025.com/api/health` returned 404 | `BACKEND_API_NOT_DEPLOYED` |
| Database/migrations | `db/`, `drizzle/0000` through `0003` | A protected Sites D1 has the ten `0000` base tables, but no verified migration ledger and no `0001` Yard or `0002`/`0003` Gallery tables | `DATABASE_NOT_PRODUCTION_VERIFIED` |
| QR / label printing | QR API, scanner, single and bounded-batch label pages in source | No Production URL because application runtime is absent | Source/build only |
| Notifications | No route, table, provider adapter or delivery worker found | None | `NOTIFICATIONS_MISSING` |
| Managed Gallery/Media Library | `app/app/gallery/`, Gallery APIs, migrations `0002`/`0003`, R2 metadata | None | Source/build only; migrations and R2 not Production-verified |

The existing public website must remain available while the application runtime
is activated. Unknown files in the Z.com Production root must remain untouched.

### Protected Sites artifact is not accepted Production

Read-only Sites control-plane evidence found an active, custom-access deployment:

```text
URL:     https://nathee-group-2025-logistics.wise-goose-4247.chatgpt.site
Version: 4
Source:  9afd58deea335c616e1a0769500e7fa46148780f
Access:  owner-only custom policy
Environment variables configured: 0
D1 tables: 10 base tables from migration 0000
```

This proves that a protected build artifact exists; it does not prove that the
NATHEE application works. Supabase Auth is not configured in that runtime, the
full migration chain is absent, and the canonical domain still returns 404 for
`/app` and `/api/health`. Its classification is
`PRIVATE_SITES_RUNTIME_NOT_ACCEPTED`, not Full Production.

## Runtime boundary

The public site is portable HTML/CSS/JavaScript and is compatible with the
proven Z.com shared-hosting deployment. The protected application is not a set
of static files. It is a Vinext Cloudflare Worker build requiring:

- server-side request handling and secure cookies;
- D1 binding `DB`;
- private R2 binding `FILES`;
- Supabase Auth public values and a server-only secret;
- forward migrations and an exact Supabase-user-to-D1 OWNER mapping.

Copying `dist/client`, `app/`, `worker/`, a database file or secrets into
`public_html` would create a broken or unsafe deployment and is forbidden. The
presence of Node or PHP on Z.com would not provide Cloudflare D1/R2 bindings.

## Target architecture

1. Keep the public company website on Z.com at
   `https://natheegroup2025.com/` until a separately reviewed cutover.
2. Deploy the full Worker artifact to a Cloudflare-compatible Sites runtime
   with real D1/R2 bindings.
3. Keep the application private until `/api/health` returns HTTP 200 with
   `authentication`, `database`, and `storage` all `true`.
4. Apply migrations `0000` through `0003` once, in order, with a migration
   ledger and pre-migration backup. Never copy or edit an applied migration.
5. Configure Supabase Site URL and callback for the final public routing model,
   then create the real OWNER mapping. No demo account is allowed.
6. Run OWNER, STAFF and two-company CUSTOMER isolation acceptance before exposing
   Login, `/app`, QR, private media or Gallery administration.
7. Route users to the application only after runtime acceptance. Until then the
   Z.com `/login/` status page remains the safe public behavior.

The final routing decision is an Owner gate because it changes DNS/domain or
authentication callbacks:

- edge-route `/login`, `/auth`, `/app` and `/api` from the apex domain to the
  application runtime while Z.com continues serving public routes; or
- use an application subdomain and update the Supabase callback accordingly.

Do not change DNS, canonical URLs, Supabase callbacks or the Z.com document root
until that routing choice is approved and rollback is documented.

## Z.com capability evidence

Run this read-only/safe-temp probe from staging:

```bash
cd /home/zptqqwps/nathee-deploy
bash scripts/probe-zcom-runtime.sh
```

The probe never writes inside Production. It reports available commands and
states explicitly that application compatibility is not proven by a Node/PHP
binary. Public deployment remains guarded by a timestamped complete backup,
sealed checksums, exact `BACKUP_PATH`, atomic per-file replacement, live
postcheck and automatic rollback. It never deletes unknown Production files.

## Production component evidence

The public-only audit is safe to run at any time:

```bash
cd /home/zptqqwps/nathee-deploy
bash scripts/audit-production-components.sh
```

After a separate application runtime is accepted, supply its exact base URL:

```bash
NATHEE_APP_BASE_URL='https://OWNER_APPROVED_APP_HOST' bash scripts/audit-production-components.sh
```

The script claims the full application only when `/api/health` returns 200 and
all three readiness checks are true. A public-site `DEPLOY_PASS` or
`PRODUCTION_POSTCHECK_PASS` continues to cover only the static component.

## Activation gates still open

- Z.com capability probe output has not yet been returned from the real shell.
- Application Production hostname/routing is not approved.
- Supabase Production Auth values are absent from the current Sites runtime and
  its callback has not been runtime-verified.
- D1 has only the ten base tables; migration ledger, `0001` Yard,
  `0002`/`0003` Gallery and R2 runtime readiness are not verified.
- Real OWNER mapping and CUSTOMER cross-company isolation are not accepted.
- Notification delivery has not been implemented.
- No real public Gallery photograph is present in the static manifest.

Until all applicable gates close, the exact accepted Production application
path and URL are **none**. Reports may identify the protected Sites artifact
only when they also say it is not operationally accepted.
