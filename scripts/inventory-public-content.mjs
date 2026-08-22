#!/usr/bin/env node
// Inventories the live static public site and maps it onto the public CMS
// consumer contract.
//
// This migrates nothing. It answers two questions ahead of any migration:
// what content actually exists today, and can that content satisfy the
// contract the public site will require of the CMS. Every page is mapped and
// then validated, so a gap shows up here rather than during a migration.
//
// Usage:
//   node scripts/inventory-public-content.mjs            # report
//   node scripts/inventory-public-content.mjs --write    # also write the map

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUBLIC_CMS_CONTRACT_VERSION,
  PUBLIC_ROUTE_PATHS,
  validatePublicPage,
} from "../lib/public-cms/contract.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = join(repositoryRoot, "public-site");
const outputPath = join(repositoryRoot, "docs", "public-content-inventory.json");

const shouldWrite = process.argv.includes("--write");

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
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? match[1] : null;
}

function formatOf(src) {
  if (src.endsWith(".webp")) return "webp";
  if (src.endsWith(".avif")) return "avif";
  if (src.endsWith(".png")) return "png";
  return "jpeg";
}

/**
 * Turns one built page into a contract-shaped PublicPage. Sections are cut at
 * each h2, which is how the pages are actually structured, and h3 blocks
 * become nested sections so the heading order is preserved rather than
 * flattened.
 */
function mapPage(path, html) {
  const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
  const description = attribute(html.match(/<meta name="description"[^>]*>/)?.[0] ?? "", "content") ?? "";
  const heading = decode(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "");

  const sections = [];
  const headingPattern = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/g;
  const found = [...html.matchAll(headingPattern)];

  found.forEach((match, index) => {
    const level = Number(match[1]);
    const text = decode(match[2]);
    const start = match.index + match[0].length;
    const end = index + 1 < found.length ? found[index + 1].index : html.length;
    const block = html.slice(start, end);

    const body = [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
      .map((paragraph) => decode(paragraph[1]))
      .filter((paragraph) => paragraph.length > 0);

    const media = [];
    for (const img of block.match(/<img\b[^>]*>/g) ?? []) {
      const src = attribute(img, "src");
      if (!src || !src.startsWith("/assets/")) continue;
      const width = Number(attribute(img, "width"));
      const height = Number(attribute(img, "height"));
      const altText = attribute(img, "alt") ?? "";

      const variants = [{ src, width, height, format: formatOf(src), role: "display" }];
      const srcset = attribute(img, "srcset");
      if (srcset) {
        const thumbnail = srcset.split(",")[0]?.trim().split(/\s+/)[0];
        if (thumbnail && thumbnail !== src && thumbnail.startsWith("/assets/")) {
          variants.unshift({ src: thumbnail, width, height, format: formatOf(thumbnail), role: "thumbnail" });
        }
      }

      media.push({
        id: src.split("/").pop().replace(/\.[a-z0-9]+$/i, ""),
        altText: decode(altText),
        caption: null,
        variants,
      });
    }

    sections.push({
      id: `${path.replaceAll("/", "-").replace(/^-|-$/g, "") || "home"}-${index + 1}`,
      heading: text || null,
      headingLevel: level,
      body,
      media,
    });
  });

  return {
    contractVersion: PUBLIC_CMS_CONTRACT_VERSION,
    slug: path === "/" ? "home" : path.replaceAll("/", ""),
    path,
    status: "PUBLISHED",
    heading,
    seo: { title, description, canonicalPath: path, robots: "INDEX" },
    sections,
    revisionId: "static-release",
    publishedAt: new Date(0).toISOString(),
  };
}

const inventory = [];
let mappable = 0;

for (const path of PUBLIC_ROUTE_PATHS) {
  const html = await readFile(join(siteRoot, routeFile(path)), "utf8");
  const page = mapPage(path, html);
  const validation = validatePublicPage(page);

  const mediaCount = page.sections.reduce((total, section) => total + section.media.length, 0);
  if (validation.ok) mappable += 1;

  inventory.push({
    path,
    slug: page.slug,
    title: page.seo.title,
    description: page.seo.description,
    h1: page.heading,
    sections: page.sections.length,
    headingLevels: page.sections.map((section) => section.headingLevel),
    paragraphs: page.sections.reduce((total, section) => total + section.body.length, 0),
    media: mediaCount,
    contractValid: validation.ok,
    violations: validation.ok ? [] : validation.violations,
  });
}

// Gallery media is authored separately from page copy and migrates as its own
// collection, so it is counted from the manifest rather than the pages.
const galleryManifest = JSON.parse(await readFile(join(siteRoot, "assets", "gallery.json"), "utf8"));
const publishedGallery = galleryManifest.items.filter((item) => item.status === "PUBLISHED");

const report = {
  generatedFrom: "public-site/",
  contractVersion: PUBLIC_CMS_CONTRACT_VERSION,
  routes: inventory,
  gallery: {
    manifestVersion: galleryManifest.version,
    categories: galleryManifest.categories.length,
    publishedItems: publishedGallery.length,
    everyItemHasAlt: publishedGallery.every((item) => typeof item.alt === "string" && item.alt.trim().length > 0),
    everyItemHasDimensions: publishedGallery.every((item) => item.width > 0 && item.height > 0),
    variantsPerItem: ["jpeg", "webp", "avif"],
  },
  totals: {
    routes: inventory.length,
    routesMappable: mappable,
    sections: inventory.reduce((total, route) => total + route.sections, 0),
    paragraphs: inventory.reduce((total, route) => total + route.paragraphs, 0),
    pageMedia: inventory.reduce((total, route) => total + route.media, 0),
  },
};

for (const route of inventory) {
  const status = route.contractValid ? "OK  " : "GAP ";
  process.stdout.write(
    `${status} ${route.path.padEnd(24)} sections=${String(route.sections).padStart(2)} paragraphs=${String(route.paragraphs).padStart(3)} media=${String(route.media).padStart(2)}\n`,
  );
  for (const violation of route.violations) {
    process.stdout.write(`       - ${violation.field}: ${violation.reason}\n`);
  }
}

process.stdout.write(
  `INVENTORY gallery=${report.gallery.publishedItems} categories=${report.gallery.categories} alt=${report.gallery.everyItemHasAlt} dimensions=${report.gallery.everyItemHasDimensions}\n`,
);

if (shouldWrite) {
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`INVENTORY_WRITTEN ${outputPath}\n`);
}

if (mappable !== inventory.length) {
  process.stderr.write(
    `INVENTORY_FAIL ${inventory.length - mappable} of ${inventory.length} routes cannot satisfy the contract\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `INVENTORY_PASS routes=${report.totals.routes} sections=${report.totals.sections} paragraphs=${report.totals.paragraphs} media=${report.totals.pageMedia} contract=v${PUBLIC_CMS_CONTRACT_VERSION}\n`,
);
