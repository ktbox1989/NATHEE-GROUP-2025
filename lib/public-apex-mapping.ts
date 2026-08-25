import { CANONICAL_PRODUCTION_ORIGIN, PUBLIC_WEBSITE_ORIGIN } from "./app-origin.ts";

/**
 * The two public surfaces the application owns that must answer on the apex.
 *
 * `/assets/media/…` is where CMS-managed photographs live, and `/sitemap.xml`
 * is the one canonical sitemap. Both are produced by the application from D1,
 * both change without a static deploy, and both are addressed by readers and
 * crawlers at `https://natheegroup2025.com`. The static release cannot hold
 * either: a photograph published this morning has no file in the document root,
 * and a sitemap copied at deploy time is stale the moment a post is published.
 *
 * ## Why a proxy and not a redirect
 *
 * `worker/index.ts` sets `Cross-Origin-Resource-Policy: same-origin` on every
 * response it serves. An `<img>` on an apex page pointing at the application
 * origin is therefore **blocked by the browser**, not merely slower — so a
 * `RewriteRule … [R=302]` cannot deliver an image at all. The apex has to
 * answer as itself and fetch the bytes behind the scenes, which is `[P]`.
 *
 * That is also why the mapping is not optional styling: the same-origin path
 * `/assets/media/<id>/<role>.<ext>` that `lib/public-media-delivery.ts` builds
 * is the only shape that loads, and this is what makes it resolve.
 *
 * ## What activation requires, and why the default is INACTIVE
 *
 * Two facts have to be true on the real host, and neither can be established
 * from this repository:
 *
 *  1. `mod_proxy` and `mod_proxy_http` are enabled for the account. Shared
 *     cPanel hosting frequently disables both, and a `[P]` rule without them
 *     does not proxy — it returns 500 or falls through to a 404, on the apex,
 *     for every managed photograph.
 *  2. The application is actually reachable at the target origin. Proxying to
 *     a host that is not serving turns a working static site into a broken one.
 *
 * `scripts/probe-zcom-runtime.sh` answers the first and
 * `scripts/verify-app-integration.sh` the second. Until both have, this block
 * stays INACTIVE and the apex behaves exactly as it does today.
 */

export const APEX_MAPPING_BEGIN = "# BEGIN NATHEE PUBLIC APEX MAPPING";
export const APEX_MAPPING_END = "# END NATHEE PUBLIC APEX MAPPING";

/**
 * The target origin.
 *
 * Taken from `lib/app-origin.ts` rather than written here, so there is one
 * statement of where the application lives. It is the canonical Production
 * origin the whole codebase already refuses to confuse with the apex — not a
 * hostname invented for this mapping.
 */
export const APEX_MAPPING_TARGET = CANONICAL_PRODUCTION_ORIGIN;
export const APEX_PUBLIC_HOST = new URL(PUBLIC_WEBSITE_ORIGIN).host;

export type ApexMappingState = "ACTIVE" | "INACTIVE" | "MISSING";

/**
 * Exactly what is proxied, and nothing else.
 *
 * A prefix list rather than a catch-all: `/api/`, `/app/`, `/auth/` and
 * `/login` must never be proxied by this block. They are authenticated
 * surfaces, and putting them on the apex would place session cookies in the
 * scope of a document root that a deploy script overwrites by file copy —
 * which is the reason `APP_ORIGIN` refuses the apex in the first place.
 *
 * `/assets/gallery/…` is deliberately absent too: those are real files in the
 * document root today and must keep being served by the apex itself. The two
 * prefixes are disjoint, so this mapping is additive to the static release.
 */
export const APEX_MAPPED_PATHS = [
  { pattern: "^assets/media/(.*)$", target: "/assets/media/$1", why: "CMS-managed photographs" },
  { pattern: "^sitemap\\.xml$", target: "/sitemap.xml", why: "the one canonical sitemap" },
] as const;

/** Paths this block must never carry, asserted by the gate rather than assumed. */
export const APEX_FORBIDDEN_PATHS = ["/api", "/app/", "/auth", "/login"] as const;

function escapeHost(host: string): string {
  return host.replaceAll(".", "\\.");
}

export function renderApexMappingBlock(state: "ACTIVE" | "INACTIVE"): string {
  const header = [
    APEX_MAPPING_BEGIN,
    `# NATHEE_PUBLIC_APEX_MAPPING_STATE=${state}`,
    `# NATHEE_PUBLIC_APEX_MAPPING_TARGET=${APEX_MAPPING_TARGET}`,
    "#",
    "# Managed by scripts/set-public-apex-mapping.mjs; do not edit by hand.",
  ];

  if (state === "INACTIVE") {
    return [
      ...header,
      "#",
      "# The application is not proxied from the apex. /assets/media/ and",
      "# /sitemap.xml are served by this static release exactly as before, and",
      "# CMS-managed media is not reachable from the public site.",
      APEX_MAPPING_END,
    ].join("\n");
  }

  return [
    ...header,
    "#",
    "# [P] is a reverse proxy, not a redirect. The application sets",
    "# Cross-Origin-Resource-Policy: same-origin on every response, so an image",
    "# linked directly to the application origin is blocked by the browser. The",
    "# reader must stay on one origin, which is what proxying gives.",
    "<IfModule mod_proxy.c>",
    "<IfModule mod_rewrite.c>",
    "  RewriteEngine On",
    "",
    "  # Only the canonical apex proxies, so the rule cannot loop if the",
    "  # application host is ever pointed at this same document root.",
    `  RewriteCond %{HTTP_HOST} ^${escapeHost(APEX_PUBLIC_HOST)}$ [NC]`,
    ...APEX_MAPPED_PATHS.flatMap((mapped) => [
      `  # ${mapped.why}`,
      `  RewriteRule ${mapped.pattern} ${APEX_MAPPING_TARGET}${mapped.target} [P,QSA,L]`,
    ]),
    "",
    "  # The proxied response carries the application's own ETag, so a",
    "  # conditional request is answered by the application rather than here.",
    "  # mod_proxy forwards If-None-Match unchanged; nothing below strips it.",
    "</IfModule>",
    "</IfModule>",
    APEX_MAPPING_END,
  ].join("\n");
}

export function parseApexMappingState(htaccess: string): ApexMappingState {
  if (!htaccess.includes(APEX_MAPPING_BEGIN) || !htaccess.includes(APEX_MAPPING_END)) return "MISSING";
  const state = htaccess.match(/^# NATHEE_PUBLIC_APEX_MAPPING_STATE=([A-Z]+)/m)?.[1];
  return state === "ACTIVE" || state === "INACTIVE" ? state : "MISSING";
}

/**
 * Whether the apex would overwrite a header the application decided.
 *
 * The static release sets `Cache-Control` for every image extension. A proxied
 * variant already carries the application's own value — which is bounded rather
 * than immutable precisely so that an item withdrawn from PUBLIC stops being
 * served within a knowable window — and the static rule would replace it with a
 * different one. The rule therefore has to exclude the proxied prefix.
 */
export function staticCacheRuleExcludesProxiedMedia(htaccess: string): boolean {
  const line = htaccess
    .split("\n")
    .find((entry) => entry.includes("Header always set Cache-Control") && entry.includes("max-age=3600"));
  return Boolean(line && line.includes("expr=") && line.includes("/assets/media/"));
}
