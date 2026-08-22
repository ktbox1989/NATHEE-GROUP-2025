# PWA readiness — public website

## Scope

The public static website is **installable**: a visitor on Android or iOS can
add NATHEE GROUP 2025 to the home screen and launch it with the company's own
icon, name, and colours instead of a browser bookmark.

It deliberately ships **no Service Worker**. That is a considered decision, not
an omission — see "Why there is no Service Worker" below.

## What is shipped

| Artefact | Path | Notes |
| --- | --- | --- |
| Web App Manifest | `/site.webmanifest` | Same-origin, `display: standalone`, scope `/` |
| Standard icons | `/assets/brand/icon-192.png`, `icon-512.png` | `purpose: any` |
| Maskable icon | `/assets/brand/icon-maskable-512.png` | Artwork inside a 64% safe zone |
| Apple touch icon | `/assets/brand/apple-touch-icon-180.png` | Opaque, linked from every page |

Every page in the eleven public routes plus `/login/` carries the manifest
link, the Apple touch icon and the `theme-color` meta, so installation can be
started from any entry point.

Manifest shortcuts point only at real public routes: `/quotation/`,
`/gallery/` and `/contact/`.

## Icons

`scripts/generate-pwa-icons.mjs` derives every icon from the Owner-supplied
brand artwork at `public-site/assets/brand/nathee-logo-display.jpg`. No icon
imagery is invented; each is a resize of the approved logo, composited onto the
brand background `#0a1020` where the platform requires an opaque or safe-zone
image.

```bash
npm run build:icons
```

The script is idempotent — re-running rewrites nothing — and refuses artwork
that is not square or is smaller than 512px. The artwork is photographic, so
icons are encoded as 256-colour palette PNGs; this is visually equivalent at
icon sizes and roughly a third of the bytes of full-colour PNG.

## Why there is no Service Worker

A cache-first Service Worker on a static marketing site can keep serving a
superseded release after a deployment, and it is difficult to purge from
devices that have already installed it. Production has already suffered one
stale-content incident, so shipping a worker without a reviewed cache
versioning and kill-switch strategy would add the same class of risk back.

The release gate enforces this: `verify-public-site.sh` and
`verify-public-site-v2.mjs` both **fail** if `sw.js` or `service-worker.js`
appears in the release. Offline support remains a separate, reviewable
decision rather than an accident.

## Hosting requirement

Shared hosting does not map the `.webmanifest` extension by default, and a
manifest served as `text/plain` is ignored by the browser. `public-site/.htaccess`
declares it:

```apache
<IfModule mod_mime.c>
  AddType application/manifest+json .webmanifest
</IfModule>
```

The live postcheck asserts the response `Content-Type`, so a host that drops
this rule fails the deployment rather than silently disabling installation.

## Verification

- `scripts/verify-public-site-v2.mjs` parses each icon's real PNG `IHDR`
  header and fails when a declared `sizes` value does not match the file, when
  the manifest is not same-origin, or when a shortcut is not a public route.
- `scripts/verify-public-site.sh` repeats the contract for the Z.com deploy
  using only portable tools (`od` for the PNG header).
- `scripts/test-public-site-gate.sh` proves the guards by rejecting broken
  copies of the real release: a missing manifest link, a wrong-sized icon, an
  off-origin icon, an added Service Worker and a missing MIME declaration.
- `scripts/postcheck-production.sh` fetches the manifest and all four icons
  from the live host, checks the PNG headers and the `Content-Type`.

## Not in scope

- Offline browsing and background sync.
- Push notifications. In-app notifications are part of the authenticated
  application, not the public static site.
- Installability for `/app` and the authenticated runtime, which is gated on
  the separate application deployment.
