import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(repo, "public-site");
const manifestPath = join(root, "assets", "gallery.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (manifest?.version !== 1 || !Array.isArray(manifest.items)) throw new Error("Unsupported Gallery manifest.");

let generated = 0;
for (const item of manifest.items) {
  for (const role of ["thumbnail", "display"]) {
    const jpegPath = item[role];
    if (typeof jpegPath !== "string" || !jpegPath.endsWith(".jpg")) throw new Error(`Missing canonical JPEG for ${item.id}/${role}`);
    const absolute = join(root, jpegPath.slice(1));
    const base = absolute.slice(0, -4);
    const webp = `${base}.webp`;
    const avif = `${base}.avif`;
    const maxWidth = role === "thumbnail" ? 640 : 1600;
    const input = await readFile(absolute);
    const metadata = await sharp(input, { failOn: "warning" }).metadata();
    const jpeg = (metadata.width ?? 0) > maxWidth
      ? await sharp(input, { failOn: "warning" }).rotate().resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality: role === "thumbnail" ? 78 : 82, mozjpeg: true }).toBuffer()
      : input;
    if (jpeg !== input) await writeFile(absolute, jpeg);
    const source = sharp(jpeg, { failOn: "warning" });
    await Promise.all([
      source.clone().webp({ quality: role === "thumbnail" ? 72 : 76, effort: 5 }).toFile(webp),
      source.clone().avif({ quality: role === "thumbnail" ? 48 : 52, effort: 5 }).toFile(avif),
    ]);
    const webpBytes = (await stat(webp)).size;
    const avifBytes = (await stat(avif)).size;
    const jpegBytes = (await stat(absolute)).size;
    if (!webpBytes || !avifBytes || webpBytes >= jpegBytes * 1.2 || avifBytes >= jpegBytes * 1.2) throw new Error(`Responsive variant failed size guard for ${item.id}/${role}`);
    item[`${role}Webp`] = jpegPath.replace(/\.jpg$/, ".webp");
    item[`${role}Avif`] = jpegPath.replace(/\.jpg$/, ".avif");
    generated += 2;
  }
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`PUBLIC_GALLERY_OPTIMIZE_PASS items=${manifest.items.length} variants=${generated}`);
