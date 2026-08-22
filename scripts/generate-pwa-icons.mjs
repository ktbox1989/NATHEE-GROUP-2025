import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Derives the installable-icon set from the Owner-supplied brand artwork.
// Nothing here invents imagery: every icon is a resize of the approved logo,
// padded on the brand background where the platform requires an opaque or
// safe-zone image. Re-running produces byte-identical files.

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(repo, "public-site");
const brandDir = join(root, "assets", "brand");
const sourcePath = join(brandDir, "nathee-logo-display.jpg");

// Matches the `theme-color` the public pages already declare.
const BRAND_BACKGROUND = { r: 10, g: 16, b: 32, alpha: 1 };

const source = await readFile(sourcePath);
const sourceMeta = await sharp(source, { failOn: "warning" }).metadata();
if (!sourceMeta.width || !sourceMeta.height) throw new Error("Could not read brand artwork dimensions.");
if (sourceMeta.width !== sourceMeta.height) throw new Error(`Brand artwork must be square, got ${sourceMeta.width}x${sourceMeta.height}.`);
if (sourceMeta.width < 512) throw new Error(`Brand artwork must be at least 512px, got ${sourceMeta.width}px.`);

// A maskable icon may be cropped to a circle, so the artwork has to sit inside
// the inner 80% safe zone. 64% keeps a margin even on aggressive masks.
const MASKABLE_CONTENT_RATIO = 0.64;

const targets = [
  { file: "icon-192.png", size: 192, mode: "contain" },
  { file: "icon-512.png", size: 512, mode: "contain" },
  { file: "icon-maskable-512.png", size: 512, mode: "maskable" },
  { file: "apple-touch-icon-180.png", size: 180, mode: "contain" },
];

const results = [];
for (const target of targets) {
  const contentSize = target.mode === "maskable"
    ? Math.round(target.size * MASKABLE_CONTENT_RATIO)
    : target.size;

  const artwork = await sharp(source, { failOn: "warning" })
    .resize({ width: contentSize, height: contentSize, fit: "cover", position: "centre" })
    .toBuffer();

  // Apple and maskable icons must be opaque, so composite onto the brand
  // background rather than relying on transparency the platform will fill.
  const padding = Math.round((target.size - contentSize) / 2);
  const png = await sharp({
    create: { width: target.size, height: target.size, channels: 4, background: BRAND_BACKGROUND },
  })
    .composite([{ input: artwork, top: padding, left: padding }])
    // The artwork is photographic, so a full-colour PNG is several hundred
    // kilobytes. A 256-colour palette is visually equivalent at icon sizes and
    // roughly a third of the bytes.
    .png({ compressionLevel: 9, palette: true, colors: 256, effort: 10 })
    .toBuffer();

  const outputPath = join(brandDir, target.file);
  let existing = null;
  try {
    existing = await readFile(outputPath);
  } catch {
    existing = null;
  }
  const changed = existing === null || !existing.equals(png);
  if (changed) await writeFile(outputPath, png);

  const written = await sharp(png, { failOn: "warning" }).metadata();
  if (written.width !== target.size || written.height !== target.size) {
    throw new Error(`${target.file} rendered ${written.width}x${written.height}, expected ${target.size}px square.`);
  }
  if (written.format !== "png") throw new Error(`${target.file} is not a PNG.`);

  results.push({
    file: target.file,
    size: target.size,
    bytes: png.length,
    purpose: target.mode === "maskable" ? "maskable" : "any",
    sha256: createHash("sha256").update(png).digest("hex").slice(0, 12),
    changed,
  });
}

for (const result of results) {
  process.stdout.write(
    `PWA_ICON ${result.file} size=${result.size} purpose=${result.purpose} bytes=${result.bytes} sha256=${result.sha256} ${result.changed ? "written" : "unchanged"}\n`,
  );
}
process.stdout.write(`PWA_ICONS_BUILD_PASS icons=${results.length} source=nathee-logo-display.jpg\n`);
