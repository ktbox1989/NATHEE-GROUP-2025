#!/usr/bin/env node
// Turns the live static release into a CMS seed, in Lane B's canonical schema.
//
// The inventory script answers "can today's content satisfy the consumer
// contract". This answers the next question: "what exactly would be imported",
// and it answers it as an artefact somebody can read, diff and review before a
// single row is written.
//
// What this deliberately does NOT do:
//
//   - write to any database, Production or otherwise;
//   - contact any network;
//   - claim that a migration happened.
//
// It reads `public-site/` and writes one JSON file. Importing it is a separate,
// reviewed act on Lane B's side.
//
// Determinism is a hard requirement, not a nicety. A seed that differs between
// runs cannot be reviewed — a diff would be noise, and nobody could tell an
// intended content change from a generator artefact. So there is no timestamp,
// no randomness and no iteration over unordered structures: the same tree
// produces byte-identical output.
//
// Usage:
//   node scripts/build-cms-seed.mjs           # report and validate
//   node scripts/build-cms-seed.mjs --write   # also write docs/cms-seed.json

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_CMS_CONTRACT_VERSION, validatePublicPage } from "../lib/public-cms/contract.ts";
import { mapCmsPageToPublicPage, galleryItemToMedia } from "../lib/public-cms/map-from-cms.ts";
import { SITE_PAGE_DEFINITIONS, parseCmsPageContent } from "../lib/site-cms-content.ts";
import { DEFAULT_SITE_SETTINGS, parseSiteSettings } from "../lib/site-settings-content.ts";

const repositoryRoot = process.env.CMS_SEED_ROOT
  ? resolve(process.env.CMS_SEED_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = join(repositoryRoot, "public-site");
const outputPath = join(repositoryRoot, "docs", "cms-seed.json");
const shouldWrite = process.argv.includes("--write");
// --check is what runs in the suite: it regenerates and compares, so the
// committed artefact cannot quietly go stale while the site moves on.
const shouldCheck = process.argv.includes("--check");

const problems = [];
function require(condition, message) {
  if (!condition) problems.push(message);
}

// --- reading the built pages ------------------------------------------------

function routeFile(path) {
  return path === "/" ? "index.html" : `${path.slice(1)}index.html`;
}

function decode(text) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
}

/** Section ids must match Lane B's id pattern, which has no slashes in it. */
function sectionId(slug, index) {
  return `${slug}-${String(index).padStart(2, "0")}`;
}

/**
 * The gallery item an <img> came from.
 *
 * Lane B stores a reference, not a URL, so the seed has to name the item. A
 * source that does not correspond to a gallery item produces no reference at
 * all rather than a made-up one — an import that silently pointed at nothing
 * would render a section with a missing image and no explanation.
 */
function galleryItemIdFor(src, galleryIds) {
  const file = src.split("/").pop() ?? "";
  const id = file.replace(/-(?:thumbnail|display)\.[a-z0-9]+$/i, "");
  return galleryIds.has(id) ? id : "";
}

function firstImageReference(block, galleryIds) {
  for (const img of block.match(/<img\b[^>]*>/g) ?? []) {
    const src = attribute(img, "src");
    if (!src?.startsWith("/assets/")) continue;
    const id = galleryItemIdFor(src, galleryIds);
    if (id) return id;
  }
  return "";
}

/**
 * Maps one built page onto `CmsPageContent`.
 *
 * The static pages are already shaped the way the CMS models them — an h1 with
 * an eyebrow, then h2 sections, some of which carry h3 features. So the mapping
 * is a reading of the existing structure rather than a reinterpretation of it,
 * which is what makes the round-trip below meaningful.
 */
function mapPageToCms(slug, html, galleryIds) {
  const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
  const description = attribute(html.match(/<meta name="description"[^>]*>/)?.[0] ?? "", "content") ?? "";
  const h1 = decode(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "");
  const eyebrow = decode(html.match(/<p class="eyebrow">([\s\S]*?)<\/p>/)?.[1] ?? "");

  // The hero body is the first paragraph after the h1, which is the page lead.
  const afterH1 = html.slice((html.match(/<h1[^>]*>[\s\S]*?<\/h1>/)?.index ?? 0));
  const heroBody = decode(afterH1.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "");

  const sections = [
    {
      id: sectionId(slug, 1),
      type: "HERO",
      enabled: true,
      eyebrow,
      heading: h1,
      body: heroBody,
      imageItemId: firstImageReference(html, galleryIds),
      primaryLabel: "",
      primaryHref: "",
      secondaryLabel: "",
      secondaryHref: "",
      galleryCategorySlug: "",
      galleryLimit: 12,
      items: [],
    },
  ];

  const headings = [...html.matchAll(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/g)];
  for (const [index, match] of headings.entries()) {
    if (Number(match[1]) !== 2) continue;
    const heading = decode(match[2]);
    if (!heading) continue;

    const start = match.index + match[0].length;
    const nextH2 = headings.slice(index + 1).find((entry) => Number(entry[1]) === 2);
    const block = html.slice(start, nextH2 ? nextH2.index : html.length);

    const body = [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
      .map((paragraph) => decode(paragraph[1]))
      .filter(Boolean);

    // h3 blocks under this h2 are the CMS's feature items.
    const features = [];
    const subHeadings = [...block.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)];
    for (const [subIndex, sub] of subHeadings.entries()) {
      const featureTitle = decode(sub[1]);
      if (!featureTitle) continue;
      const subStart = sub.index + sub[0].length;
      const subEnd = subIndex + 1 < subHeadings.length ? subHeadings[subIndex + 1].index : block.length;
      const featureBody = decode(block.slice(subStart, subEnd).match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "");
      // Lane B caps a section at twelve features.
      if (features.length < 12) features.push({ title: featureTitle, body: featureBody });
    }

    sections.push({
      id: sectionId(slug, sections.length + 1),
      type: features.length > 0 ? "FEATURES" : "CONTENT",
      enabled: true,
      eyebrow: "",
      heading,
      // A CONTENT section needs its copy; a FEATURES section carries it on the
      // items, and its lead paragraph is the first body paragraph.
      body: body.slice(0, 1).join(" ").slice(0, 2000),
      imageItemId: firstImageReference(block, galleryIds),
      primaryLabel: "",
      primaryHref: "",
      secondaryLabel: "",
      secondaryHref: "",
      galleryCategorySlug: "",
      galleryLimit: 12,
      items: features,
    });

    // Lane B caps a page at twenty sections.
    if (sections.length >= 20) break;
  }

  return { version: 1, seo: { title: title.slice(0, 120), description: description.slice(0, 300) }, sections };
}

// --- the gallery ------------------------------------------------------------

const manifest = JSON.parse(await readFile(join(siteRoot, "assets", "gallery.json"), "utf8"));
require(manifest.version === 1, `gallery manifest is version ${manifest.version}, not 1`);

const publishedItems = manifest.items
  .filter((item) => item.status === "PUBLISHED")
  .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
const galleryIds = new Set(publishedItems.map((item) => item.id));

const usedCategories = new Set(publishedItems.map((item) => item.category));
const seedGallery = {
  categories: manifest.categories
    .filter((category) => usedCategories.has(category.id))
    .map((category) => ({ id: category.id, slug: category.id, label: category.label }))
    .sort((left, right) => (left.id < right.id ? -1 : 1)),
  items: publishedItems.map((item) => ({
    id: item.id,
    title: item.title,
    caption: item.caption || null,
    altText: item.alt,
    categoryId: item.category,
    status: "PUBLISHED",
    // Every seeded photograph is marketing media. Customer and job evidence is
    // a different table and is not represented here at all.
    visibility: "PUBLIC",
    featured: Boolean(item.featured),
    order: Number(item.order),
    width: item.width,
    height: item.height,
    variants: [
      { role: "THUMBNAIL", format: "jpeg", src: item.thumbnail },
      { role: "THUMBNAIL", format: "webp", src: item.thumbnailWebp },
      { role: "THUMBNAIL", format: "avif", src: item.thumbnailAvif },
      { role: "DISPLAY", format: "jpeg", src: item.display },
      { role: "DISPLAY", format: "webp", src: item.displayWebp },
      { role: "DISPLAY", format: "avif", src: item.displayAvif },
    ].filter((variant) => typeof variant.src === "string" && variant.src.startsWith("/assets/")),
  })),
};

for (const item of seedGallery.items) {
  require(item.altText?.trim().length > 0, `gallery item ${item.id} has no alt text`);
  require(item.width > 0 && item.height > 0, `gallery item ${item.id} has no real dimensions`);
  require(item.variants.length >= 2, `gallery item ${item.id} has too few variants`);
}

// --- the pages --------------------------------------------------------------

const seedPages = {};
const roundTrips = [];

// Sorted, so the artefact does not depend on object key order.
for (const slug of Object.keys(SITE_PAGE_DEFINITIONS).sort()) {
  const definition = SITE_PAGE_DEFINITIONS[slug];
  const path = definition.path === "/" ? "/" : `${definition.path}/`;
  const html = await readFile(join(siteRoot, routeFile(path)), "utf8");

  const content = mapPageToCms(slug, html, galleryIds);

  // The seed has to be something Lane B would actually accept. Its own parser
  // is the authority, so it is the gate — not a reimplementation of it here.
  const parsed = parseCmsPageContent(content);
  require(parsed !== null, `${slug}: the seeded content is not accepted by parseCmsPageContent`);
  if (!parsed) continue;

  seedPages[slug] = parsed;

  // And the strong claim: seeding this content must reproduce a public page
  // that still satisfies the consumer contract. Without this the seed could be
  // valid input that renders nothing.
  const mapped = mapCmsPageToPublicPage({
    slug,
    cmsPath: definition.path,
    state: { status: "PUBLISHED", content: parsed, revisionId: "seed" },
    publishedAt: "1970-01-01T00:00:00.000Z",
    resolveMedia: (imageItemId) => {
      const item = publishedItems.find((candidate) => candidate.id === imageItemId);
      if (!item) return null;
      return galleryItemToMedia({
        id: item.id,
        altText: item.alt,
        caption: item.caption || null,
        thumbnailSrc: item.thumbnail,
        displaySrc: item.display,
        width: item.width,
        height: item.height,
      });
    },
  });

  require(mapped.ok, `${slug}: seeded content does not map back to a valid public page` +
    (mapped.ok ? "" : ` — ${mapped.reason}${(mapped.violations ?? []).map((violation) => `\n      ${violation.field}: ${violation.reason}`).join("")}`));
  if (mapped.ok) {
    const revalidated = validatePublicPage(mapped.page);
    require(revalidated.ok, `${slug}: the round-tripped page fails the consumer contract`);
    roundTrips.push(slug);
  }
}

// --- settings ---------------------------------------------------------------

// The current release's brand, telephone numbers, navigation and footer, taken
// from the defaults the application already ships rather than re-derived from
// the HTML: they are the same values, and one source is better than two.
const seedSettings = parseSiteSettings(DEFAULT_SITE_SETTINGS);
require(seedSettings !== null, "the seeded site settings are not accepted by parseSiteSettings");

// --- the artefact -----------------------------------------------------------

const seed = {
  seedVersion: 1,
  consumerContractVersion: PUBLIC_CMS_CONTRACT_VERSION,
  generatedFrom: "public-site/",
  // No timestamp: a seed that differs between runs cannot be reviewed as a
  // diff, and the source tree is what identifies this artefact anyway.
  pages: seedPages,
  gallery: seedGallery,
  settings: seedSettings,
  // Editorial content does not exist yet. An empty list is the honest seed;
  // inventing a launch announcement would put words on the public site that
  // nobody wrote.
  posts: [],
};

const serialised = `${JSON.stringify(seed, null, 2)}\n`;

for (const slug of Object.keys(seedPages)) {
  const content = seedPages[slug];
  process.stdout.write(
    `SEED ${slug.padEnd(22)} sections=${String(content.sections.length).padStart(2)} ` +
      `features=${String(content.sections.reduce((total, section) => total + section.items.length, 0)).padStart(2)} ` +
      `images=${content.sections.filter((section) => section.imageItemId).length}\n`,
  );
}

if (problems.length > 0) {
  process.stderr.write("CMS_SEED_FAIL\n");
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}

if (shouldCheck) {
  let committed;
  try {
    committed = await readFile(outputPath, "utf8");
  } catch {
    process.stderr.write(`CMS_SEED_FAIL no committed seed at ${outputPath}; run with --write\n`);
    process.exit(1);
  }
  // Compared with line endings normalised: the artefact is checked out CRLF on
  // Windows, and a gate that only failed there would be worse than no gate.
  if (committed.split("\r\n").join("\n") !== serialised) {
    process.stderr.write("CMS_SEED_FAIL the committed seed no longer matches the static release; run with --write\n");
    process.exit(1);
  }
  process.stdout.write("CMS_SEED_CHECK_PASS the committed seed matches the static release\n");
}

if (shouldWrite) {
  await writeFile(outputPath, serialised, "utf8");
  process.stdout.write(`CMS_SEED_WRITTEN ${outputPath}\n`);
}

process.stdout.write(
  `CMS_SEED_PASS pages=${Object.keys(seedPages).length} roundTripped=${roundTrips.length} ` +
    `galleryItems=${seedGallery.items.length} galleryCategories=${seedGallery.categories.length} ` +
    `posts=${seed.posts.length} bytes=${Buffer.byteLength(serialised)} databaseWrites=0\n`,
);
