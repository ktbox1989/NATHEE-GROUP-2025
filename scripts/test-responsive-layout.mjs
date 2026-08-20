import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(repo, path), "utf8");
const [publicCss, publicJs, publicHome, appCss, appNav, cmsNav, cmsPage, lightbox, manifestText] = await Promise.all([
  read("public-site/assets/site.css"), read("public-site/assets/site.js"), read("public-site/index.html"), read("app/globals.css"),
  read("components/app-nav.tsx"), read("components/cms-public-nav.tsx"), read("components/cms-public-page.tsx"),
  read("components/gallery-lightbox.tsx"), read("public-site/assets/gallery.json"),
]);

const viewports = [320, 375, 390, 768, 1024, 1366, 1440];
for (const token of ["overflow-x: clip", "--shell: min(100% - 28px", "@media (max-width: 980px)", "@media (max-width: 680px)", "@media (max-width: 360px)", "font-size: clamp(", ".site-nav.is-open", "min-height: 48px", "aspect-ratio: 4 / 3", "object-fit: contain"]) assert.ok(publicCss.includes(token), `Public responsive token missing: ${token}`);
for (const token of ["overflow-x: clip", "calc(100% - clamp(28px, 4vw, 64px))", "@media (max-width: 940px)", "@media (max-width: 600px)", "@media (max-width: 360px)", ".data-table-wrap", "overflow-x: auto", ".app-side-links.is-open", ".cms-nav nav.is-open", "aspect-ratio: 4 / 3", "object-fit: contain"]) assert.ok(appCss.includes(token), `Application responsive token missing: ${token}`);
for (const token of ["aria-expanded={open}", "aria-controls={menuId}", "Escape", "app-side-links"]) assert.ok(appNav.includes(token), `Application navigation contract missing: ${token}`);
for (const token of ["aria-expanded={open}", "aria-controls={menuId}", "Escape", "cms-nav-toggle"]) assert.ok(cmsNav.includes(token), `CMS navigation contract missing: ${token}`);
for (const token of ["width={96}", "height={96}", "data-orientation={orientation}", "galleryImageVariants.role", "sizes="]) assert.ok(cmsPage.includes(token), `CMS image sizing contract missing: ${token}`);
for (const token of ["width={640}", "height={480}", "loading=\"lazy\"", "sizes="]) assert.ok(lightbox.includes(token), `Gallery CLS/loading contract missing: ${token}`);
for (const token of ["thumbnailAvif", "displayAvif", "source.sizes", "image.srcset", "image.fetchPriority"]) assert.ok(publicJs.includes(token), `Public responsive image contract missing: ${token}`);
for (const token of ["nathee-logo-thumbnail.webp", "sizes=\"(max-width: 680px) 250px", "width=\"1000\"", "height=\"1000\""]) assert.ok(publicHome.includes(token), `Hero responsive image contract missing: ${token}`);

for (const path of ["app/app/companies/page.tsx", "app/app/jobs/page.tsx", "app/app/motorcycles/page.tsx", "app/app/yard/page.tsx", "app/app/audit/page.tsx"]) {
  const source = await read(path);
  assert.ok(source.includes('className="data-table-wrap" tabIndex={0} role="region"'), `${path} table region is not keyboard accessible`);
  assert.ok(source.includes("เลื่อนแนวนอนได้บนหน้าจอเล็ก"), `${path} table scrolling has no accessible label`);
}

for (const match of publicHome.matchAll(/<img\b[^>]*>/g)) {
  for (const attribute of ["alt", "width", "height"]) assert.match(match[0], new RegExp(`\\b${attribute}="[^"]+"`), `Public hero image missing ${attribute}`);
}

const manifest = JSON.parse(manifestText);
assert.equal(manifest.version, 1);
assert.ok(manifest.items.length > 0);
let imageChecks = 0;
for (const item of manifest.items) {
  for (const role of ["thumbnail", "display"]) {
    for (const [field, format] of [[role, "jpeg"], [`${role}Webp`, "webp"], [`${role}Avif`, "heif"]]) {
      const relative = item[field];
      assert.match(relative, /^\/assets\/gallery\/[a-z0-9-]+-(?:thumbnail|display)\.(?:jpg|webp|avif)$/);
      const absolute = join(repo, "public-site", relative.slice(1));
      const info = await stat(absolute);
      const metadata = await sharp(absolute).metadata();
      assert.ok(info.size > 0 && info.size <= (role === "thumbnail" ? 180_000 : 800_000), `${relative} exceeds mobile image budget`);
      assert.equal(metadata.format, format, `${relative} format mismatch`);
      assert.ok((metadata.width ?? 0) <= (role === "thumbnail" ? 640 : 1600), `${relative} width exceeds responsive role`);
      imageChecks += 1;
    }
  }
}

console.log(`RESPONSIVE_LAYOUT_VERIFY_PASS viewports=${viewports.join(",")} tables=5 imageVariants=${imageChecks}`);
