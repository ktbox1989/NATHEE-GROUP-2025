#!/usr/bin/env node
// Generates the static release's sitemap from the same builder the application
// route uses, so the two can never disagree about what a public route is.
//
// The application owns the sitemap. This file exists because the apex still
// serves the static release: until the apex proxies /sitemap.xml, the file in
// the document root is what crawlers read. Generating it rather than
// maintaining it by hand is what keeps that from becoming a second, divergent
// source.
//
// Usage:
//   node scripts/build-public-sitemap.mjs --check   # fails if the file is stale
//   node scripts/build-public-sitemap.mjs --write

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStaticReleaseSitemap } from "../lib/public-sitemap.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sitemapPath = join(repositoryRoot, "public-site", "sitemap.xml");

const mode = process.argv[2] ?? "--check";
if (!["--check", "--write"].includes(mode)) {
  process.stderr.write("PUBLIC_SITEMAP_FAIL: usage: --check | --write\n");
  process.exit(1);
}

const expected = buildStaticReleaseSitemap();
const actual = (await readFile(sitemapPath, "utf8")).replaceAll("\r\n", "\n");

if (mode === "--write") {
  if (actual === expected) {
    process.stdout.write("PUBLIC_SITEMAP_UNCHANGED\n");
    process.exit(0);
  }
  await writeFile(sitemapPath, expected, "utf8");
  process.stdout.write("PUBLIC_SITEMAP_WRITTEN public-site/sitemap.xml\n");
  process.exit(0);
}

if (actual !== expected) {
  process.stderr.write(
    "PUBLIC_SITEMAP_FAIL the static sitemap does not match the builder; run node scripts/build-public-sitemap.mjs --write\n",
  );
  process.exit(1);
}

const urls = expected.match(/<loc>/g)?.length ?? 0;
process.stdout.write(`PUBLIC_SITEMAP_CHECK_PASS urls=${urls} owner=application source=lib/public-sitemap.ts\n`);
