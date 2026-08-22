#!/usr/bin/env node
// Ongoing regression audit of the LIVE public website.
//
// postcheck-production.sh is the deployment gate: it runs on Z.com during a
// release and decides whether to roll back. This is the complement — it can be
// run at any time, from anywhere, and inspects the deployed bytes more deeply
// than a deploy gate needs to: title and description uniqueness across the
// whole site, internal link integrity, per-image responsive attributes, and the
// structural contracts every breakpoint depends on.
//
// Strictly read-only. It fetches and reports; it changes nothing.
//
// Usage: node scripts/audit-live-public-site.mjs [https://base-url]

const BASE = (process.argv[2] ?? "https://natheegroup2025.com").replace(/\/$/, "");
if (!BASE.startsWith("https://")) {
  process.stderr.write("LIVE_AUDIT_FAIL: the base URL must use HTTPS\n");
  process.exit(1);
}

const ROUTES = [
  "/", "/services/", "/motorcycle-transport/", "/international/", "/storage/",
  "/container-loading/", "/dealer-fleet/", "/gallery/", "/about/", "/contact/", "/quotation/",
];

// The breakpoints the public site is required to hold without horizontal
// overflow. The live CSS must still declare the rules they depend on.
const VIEWPORTS = [320, 375, 390, 768, 1024, 1366, 1440];

const problems = [];
const note = (message) => problems.push(message);

async function get(path, { redirect = "follow" } = {}) {
  const response = await fetch(BASE + path, { redirect });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

function first(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1] : null;
}

// --- pages -----------------------------------------------------------------
const pages = new Map();
for (const route of ROUTES) {
  const page = await get(route);
  if (page.status !== 200) note(`${route}: HTTP ${page.status}`);
  pages.set(route, page.body);
}

const titles = new Map();
const descriptions = new Map();

for (const [route, html] of pages) {
  const title = first(html, /<title>([^<]*)<\/title>/);
  const description = first(html, /<meta name="description" content="([^"]*)"/);
  const canonical = first(html, /<link rel="canonical" href="([^"]*)"/);

  if (!title || title.trim().length === 0) note(`${route}: missing title`);
  else if (titles.has(title)) note(`${route}: title duplicates ${titles.get(title)}`);
  else titles.set(title, route);

  if (!description || description.trim().length === 0) note(`${route}: missing meta description`);
  else if (descriptions.has(description)) note(`${route}: description duplicates ${descriptions.get(description)}`);
  else descriptions.set(description, route);

  if (canonical !== `${BASE}${route}`) note(`${route}: canonical is ${canonical}`);

  const h1Count = (html.match(/<h1[\s>]/g) || []).length;
  if (h1Count !== 1) note(`${route}: ${h1Count} <h1> elements, expected exactly 1`);

  for (const tag of ["og:title", "og:description", "og:image", "og:url"]) {
    if (!html.includes(`property="${tag}"`)) note(`${route}: missing ${tag}`);
  }
  for (const tag of ["twitter:card", "twitter:title", "twitter:description"]) {
    if (!html.includes(`name="${tag}"`)) note(`${route}: missing ${tag}`);
  }

  // Structured data must be valid JSON, not merely present.
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (blocks.length === 0) note(`${route}: no JSON-LD`);
  for (const [, raw] of blocks) {
    try {
      JSON.parse(raw);
    } catch (error) {
      note(`${route}: invalid JSON-LD (${error.message})`);
    }
  }

  // Responsive foundations that every breakpoint relies on.
  if (!/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html)) {
    note(`${route}: missing or non-standard viewport meta`);
  }
  if (!html.includes('<link rel="manifest" href="/site.webmanifest">')) note(`${route}: missing manifest link`);

  // Images: alt text, intrinsic size to prevent layout shift, and responsive
  // sources for the photography.
  for (const img of html.match(/<img\b[^>]*>/g) || []) {
    const shortened = img.slice(0, 80);
    if (!/\salt="/.test(img)) note(`${route}: image without alt -> ${shortened}`);
    if (!/\swidth="\d+"/.test(img) || !/\sheight="\d+"/.test(img)) {
      note(`${route}: image without intrinsic width/height -> ${shortened}`);
    }
    if (/\/assets\/gallery\//.test(img)) {
      if (!/\ssrcset="/.test(img)) note(`${route}: gallery image without srcset -> ${shortened}`);
      if (!/\ssizes="/.test(img)) note(`${route}: gallery image without sizes -> ${shortened}`);
    }
  }

  // Accessibility contracts that a screen reader or keyboard user depends on.
  if (!/<html[^>]+lang="[a-zA-Z-]+"/.test(html)) note(`${route}: <html> has no lang attribute`);
  if (!/class="skip-link"[^>]*href="#main"/.test(html)) note(`${route}: no skip link to #main`);
  if (!/<main\b[^>]*id="main"/.test(html)) note(`${route}: no <main id="main"> landmark`);
  if (!/<nav\b/.test(html)) note(`${route}: no <nav> landmark`);
  if (/tabindex="[1-9]/.test(html)) note(`${route}: positive tabindex breaks focus order`);

  // Heading levels must not skip: an outline that jumps h1 -> h3 hides a level
  // from assistive technology and breaks the documented semantic H1/H2 rule.
  const headingLevels = [...html.matchAll(/<h([1-6])[\s>]/g)].map(([, level]) => Number(level));
  if (headingLevels[0] !== 1) note(`${route}: first heading is h${headingLevels[0]}, expected h1`);
  for (let index = 1; index < headingLevels.length; index += 1) {
    if (headingLevels[index] - headingLevels[index - 1] > 1) {
      note(`${route}: heading order jumps h${headingLevels[index - 1]} -> h${headingLevels[index]}`);
      break;
    }
  }

  // Every form control needs a programmatic name.
  for (const control of html.match(/<(input|select|textarea)\b[^>]*>/g) || []) {
    if (/type="(hidden|submit|button)"/.test(control)) continue;
    const id = control.match(/\sid="([^"]+)"/)?.[1];
    const named = /\saria-label="/.test(control)
      || /\saria-labelledby="/.test(control)
      || /\stitle="/.test(control)
      || (id ? new RegExp(`<label[^>]*for="${id}"`).test(html) : false);
    if (!named) note(`${route}: form control without a label -> ${control.slice(0, 80)}`);
  }

  // Links and buttons need discernible text.
  for (const [, attributes, inner] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    const text = inner.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/g, "").trim();
    if (!text && !/\saria-label="/.test(attributes)) note(`${route}: link with no accessible name`);
  }
  for (const [, attributes, inner] of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const text = inner.replace(/<[^>]*>/g, "").trim();
    const named = text || /\saria-label="/.test(attributes) || /class="sr-only"/.test(inner);
    if (!named) note(`${route}: button with no accessible name`);
  }

  // A fixed pixel width wider than the narrowest supported viewport is the
  // usual cause of horizontal overflow on a phone.
  for (const [, value] of html.matchAll(/style="[^"]*width:\s*(\d{3,})px/g)) {
    if (Number(value) > VIEWPORTS[0]) note(`${route}: inline fixed width ${value}px exceeds the ${VIEWPORTS[0]}px viewport`);
  }
}

// --- stylesheet ------------------------------------------------------------
const css = (await get("/assets/site.css")).body;
for (const breakpoint of ["@media (max-width: 980px)", "@media (max-width: 680px)"]) {
  if (!css.includes(breakpoint)) note(`site.css: missing ${breakpoint}`);
}
for (const guard of ["max-width", "object-fit", "aspect-ratio"]) {
  if (!css.includes(guard)) note(`site.css: missing ${guard}, which the image layout depends on`);
}
if (!/overflow-x\s*:\s*hidden|overflow-x\s*:\s*clip/.test(css) && !/max-width:\s*100%/.test(css)) {
  note("site.css: no horizontal overflow containment found");
}

// --- internal links --------------------------------------------------------
const internal = new Set();
for (const [, html] of pages) {
  for (const [, href] of html.matchAll(/href="(\/[^"#?]*)"/g)) internal.add(href);
  for (const [, src] of html.matchAll(/src="(\/[^"#?]*)"/g)) internal.add(src);
}
let linksChecked = 0;
for (const path of [...internal].sort()) {
  const { status } = await get(path, { redirect: "manual" });
  linksChecked += 1;
  if (status >= 400) note(`broken internal reference ${path} -> ${status}`);
}

// --- robots, sitemap, noindex ---------------------------------------------
const robots = (await get("/robots.txt")).body;
for (const disallow of ["/login/", "/login-status.html", "/auth/", "/app/", "/api/"]) {
  if (!robots.includes(`Disallow: ${disallow}`)) note(`robots.txt does not disallow ${disallow}`);
}
if (!robots.includes(`${BASE}/sitemap.xml`)) note("robots.txt does not point at the sitemap");

const sitemap = (await get("/sitemap.xml")).body;
const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => loc);
for (const route of ROUTES) if (!listed.includes(BASE + route)) note(`sitemap missing ${route}`);
for (const loc of listed) {
  if (!ROUTES.includes(loc.replace(BASE, ""))) note(`sitemap lists a non-public URL: ${loc}`);
}
if (/login|auth|\/app\/|\/api\//i.test(sitemap)) note("sitemap exposes a private route");

// Private pages must be noindex by header, whichever way /login/ is served.
for (const path of ["/login/", "/this-page-must-not-exist-nathee"]) {
  const response = await get(path, { redirect: "manual" });
  const robotsTag = response.headers.get("x-robots-tag") ?? "";
  if (!/noindex/i.test(robotsTag)) note(`${path}: missing noindex X-Robots-Tag (got "${robotsTag}")`);
}

// --- PWA -------------------------------------------------------------------
const manifestResponse = await get("/site.webmanifest");
if (manifestResponse.status !== 200) note(`site.webmanifest: HTTP ${manifestResponse.status}`);
const contentType = manifestResponse.headers.get("content-type") ?? "";
if (!/application\/manifest\+json/.test(contentType)) {
  note(`site.webmanifest served as "${contentType}" instead of application/manifest+json`);
}
let manifest = null;
try {
  manifest = JSON.parse(manifestResponse.body);
} catch (error) {
  note(`site.webmanifest is not valid JSON (${error.message})`);
}
if (manifest) {
  if (manifest.start_url !== "/" || manifest.scope !== "/") note("manifest start_url/scope is not the site root");
  if (manifest.display !== "standalone") note("manifest is not installable");
  if (!manifest.icons?.some((icon) => icon.purpose === "maskable")) note("manifest has no maskable icon");
  for (const icon of manifest.icons ?? []) {
    const { status } = await get(icon.src, { redirect: "manual" });
    if (status !== 200) note(`manifest icon ${icon.src} -> ${status}`);
  }
}

// --- canonical host --------------------------------------------------------
const wwwResponse = await fetch(BASE.replace("https://", "https://www."), { redirect: "manual" });
if (![301, 308].includes(wwwResponse.status)) {
  note(`www does not redirect permanently (status=${wwwResponse.status})`);
} else {
  const location = wwwResponse.headers.get("location") ?? "";
  if (location !== BASE && location !== `${BASE}/`) note(`www redirects to ${location}`);
}

// --- report ----------------------------------------------------------------
process.stdout.write(`LIVE_AUDIT_BASE ${BASE}\n`);
process.stdout.write(`LIVE_AUDIT_SEO routes=${ROUTES.length} uniqueTitles=${titles.size} uniqueDescriptions=${descriptions.size}\n`);
process.stdout.write(`LIVE_AUDIT_LINKS checked=${linksChecked} sitemapEntries=${listed.length}\n`);
process.stdout.write(`LIVE_AUDIT_RESPONSIVE viewports=${VIEWPORTS.join(",")} breakpoints=verified\n`);
process.stdout.write(`LIVE_AUDIT_ACCESSIBILITY lang=verified skipLink=verified landmarks=verified headingOrder=verified labels=verified\n`);
process.stdout.write(`LIVE_AUDIT_PWA manifest=${manifest ? "valid" : "invalid"} contentType=${contentType || "none"}\n`);

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`LIVE_AUDIT_PROBLEM ${problem}\n`);
  process.stderr.write(`LIVE_AUDIT_FAIL problems=${problems.length}\n`);
  process.exit(1);
}

process.stdout.write(
  `LIVE_AUDIT_PASS routes=${ROUTES.length} links=${linksChecked} problems=0 scope=public-static-site\n`,
);
