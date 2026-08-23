import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A seed generator that never refuses anything is worse than none: it turns
// "the import was generated successfully" into a statement that means nothing,
// and the damage only appears after the content is in a database.
//
// Each case below breaks the static release in a way that should make the seed
// unbuildable — content the CMS would reject, media that could not be rendered,
// or a reference to a photograph that does not exist. The generator has to
// notice before the artefact is written, not after.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generator = join(root, "scripts/build-cms-seed.mjs");

const TRACKED_TREES = ["public-site", "docs"];

const HOME = "public-site/index.html";
const SERVICES = "public-site/services/index.html";
const MANIFEST = "public-site/assets/gallery.json";

const CASES = [
  {
    // The h1 becomes the CMS hero heading, and a section with no heading is
    // refused by parseCmsPageContent. A page with no h1 also fails the public
    // accessibility gate, so this is a defect twice over.
    name: "a page loses its h1, so the hero section has no heading",
    apply: (directory) => edit(directory, HOME, (source) => source.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, "")),
  },
  {
    name: "a page loses its meta description, which the CMS requires",
    apply: (directory) =>
      edit(directory, SERVICES, (source) => source.replace(/<meta name="description"[^>]*>/, "")),
  },
  {
    name: "a description is truncated below what the CMS accepts",
    apply: (directory) =>
      edit(directory, SERVICES, (source) =>
        source.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="สั้น">'),
      ),
  },
  {
    name: "a title is truncated below what the CMS accepts",
    apply: (directory) => edit(directory, SERVICES, (source) => source.replace(/<title>[^<]*<\/title>/, "<title>ส</title>")),
  },
  {
    name: "a gallery photograph loses its alt text",
    apply: (directory) =>
      editJson(directory, MANIFEST, (manifest) => {
        manifest.items[0].alt = "";
        return manifest;
      }),
  },
  {
    name: "a gallery photograph loses its real dimensions",
    apply: (directory) =>
      editJson(directory, MANIFEST, (manifest) => {
        manifest.items[0].width = 0;
        return manifest;
      }),
  },
  {
    name: "a gallery photograph is served from an authenticated path",
    apply: (directory) =>
      editJson(directory, MANIFEST, (manifest) => {
        for (const role of ["thumbnail", "display", "thumbnailWebp", "displayWebp", "thumbnailAvif", "displayAvif"]) {
          manifest.items[0][role] = "/api/motorcycles/1/photo.jpg";
        }
        return manifest;
      }),
  },
  {
    name: "the gallery manifest changes to a version this generator does not know",
    apply: (directory) =>
      editJson(directory, MANIFEST, (manifest) => {
        manifest.version = 2;
        return manifest;
      }),
  },
  {
    // The committed artefact has to keep matching the site, or reviewing the
    // diff before an import proves nothing.
    name: "the site changes and the committed seed is not regenerated",
    apply: (directory) =>
      edit(directory, HOME, (source) =>
        source.replace(/<title>[^<]*<\/title>/, "<title>ชื่อหน้าที่เปลี่ยนไปโดยไม่ได้สร้าง seed ใหม่</title>"),
      ),
    argv: ["--check"],
  },
  {
    name: "the committed seed is deleted",
    apply: (directory) => rmSync(join(directory, "docs/cms-seed.json")),
    argv: ["--check"],
  },
];

function edit(directory, relativePath, transform) {
  const target = join(directory, relativePath);
  // Normalise to LF first: every anchor is written with "\n", and on a CRLF
  // checkout the replacement would silently become a no-op.
  const original = readFileSync(target, "utf8").split("\r\n").join("\n");
  const next = transform(original);
  if (next === original) throw new Error(`mutation changed nothing: ${relativePath}`);
  writeFileSync(target, next);
}

function editJson(directory, relativePath, transform) {
  const target = join(directory, relativePath);
  const original = readFileSync(target, "utf8");
  const next = `${JSON.stringify(transform(JSON.parse(original)), null, 2)}\n`;
  if (next === original) throw new Error(`mutation changed nothing: ${relativePath}`);
  writeFileSync(target, next);
}

function makeCopy() {
  const directory = mkdtempSync(join(tmpdir(), "nathee-cms-seed-"));
  for (const tree of TRACKED_TREES) {
    cpSync(join(root, tree), join(directory, tree), { recursive: true });
  }
  mkdirSync(join(directory, "scripts"), { recursive: true });
  return directory;
}

function runGenerator(directory, argv = []) {
  return spawnSync(process.execPath, [generator, ...argv], {
    env: { ...process.env, CMS_SEED_ROOT: directory },
    encoding: "utf8",
  });
}

let failures = 0;

const clean = makeCopy();
const cleanResult = runGenerator(clean, ["--check"]);
if (cleanResult.status !== 0) {
  failures += 1;
  console.error(`CMS_SEED_NEGATIVE_FAIL unmodified tree was rejected\n${cleanResult.stderr}`);
}
rmSync(clean, { recursive: true, force: true });

for (const testCase of CASES) {
  const directory = makeCopy();
  try {
    testCase.apply(directory);
    if (runGenerator(directory, testCase.argv ?? []).status === 0) {
      failures += 1;
      console.error(`CMS_SEED_NEGATIVE_FAIL generator accepted: ${testCase.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`CMS_SEED_NEGATIVE_FAIL case failed to run: ${testCase.name}: ${error}`);
  }
  rmSync(directory, { recursive: true, force: true });
}

// And the property the whole artefact depends on: two runs over the same tree
// must produce the same bytes, or the diff a reviewer reads before an import is
// noise rather than content.
const stable = makeCopy();
const first = runGenerator(stable, ["--write"]);
const firstBytes = readFileSync(join(stable, "docs/cms-seed.json"), "utf8");
const second = runGenerator(stable, ["--write"]);
const secondBytes = readFileSync(join(stable, "docs/cms-seed.json"), "utf8");
if (first.status !== 0 || second.status !== 0 || firstBytes !== secondBytes) {
  failures += 1;
  console.error("CMS_SEED_NEGATIVE_FAIL the seed is not byte-identical across runs");
}
rmSync(stable, { recursive: true, force: true });

if (failures > 0) process.exit(1);
console.log(`CMS_SEED_NEGATIVE_PASS rejections=${CASES.length} acceptances=1 deterministic=true`);
