import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Each case is a regression that a person actually runs into: a control their
// screen reader announces as "button", a link that says "→", a menu they have
// to tab through every time, a form field with nothing attached to it.
//
// The skip-link case is not hypothetical. Until this gate existed, /login/
// rendered the entire site navigation with no skip link, because it is built
// by a different function from the eleven marketing routes and the release
// verifier only ever looked at those eleven.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts/test-public-accessibility.mjs");

const HOME = "public-site/index.html";
const GALLERY = "public-site/gallery/index.html";
const LOGIN = "public-site/login/index.html";
const CSS = "public-site/assets/site.css";

const CASES = [
  {
    name: "a page loses its h1",
    apply: (directory) => edit(directory, HOME, (source) => source.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, "")),
  },
  {
    name: "a page gains a second h1",
    apply: (directory) =>
      edit(directory, HOME, (source) => source.replace("</main>", "<h1>อีกหัวข้อหนึ่ง</h1></main>")),
  },
  {
    name: "the heading outline skips a level",
    apply: (directory) =>
      edit(directory, HOME, (source) => source.replace("</main>", "<h4>ข้ามระดับ</h4></main>")),
  },
  {
    name: "a page loses its language",
    apply: (directory) => edit(directory, HOME, (source) => source.replace('<html lang="th">', "<html>")),
  },
  {
    name: "a page loses its main landmark",
    apply: (directory) =>
      edit(directory, HOME, (source) => source.replace('<main id="main">', "<div>").replace("</main>", "</div>")),
  },
  {
    // The defect this gate was written for.
    name: "a page renders the navigation but loses its skip link",
    apply: (directory) =>
      edit(directory, LOGIN, (source) => source.replace(/<a class="skip-link"[^>]*>[\s\S]*?<\/a>/, "")),
  },
  {
    name: "the skip link points at a target that does not exist",
    apply: (directory) => edit(directory, HOME, (source) => source.replace('<main id="main">', "<main>")),
  },
  {
    name: "a nav landmark loses its name",
    apply: (directory) => edit(directory, HOME, (source) => source.replace(' aria-label="เมนูหลัก"', "")),
  },
  {
    name: "an icon button loses the text that named it",
    apply: (directory) =>
      edit(directory, HOME, (source) => source.replace('<span class="sr-only">เปิดเมนู</span>', "")),
  },
  {
    name: "a lightbox control loses its label, leaving only a decorative glyph",
    apply: (directory) => edit(directory, GALLERY, (source) => source.replace(' aria-label="ปิด"', "")),
  },
  {
    name: "a link is reduced to a bare arrow",
    apply: (directory) =>
      edit(directory, HOME, (source) =>
        source.replace(/<a class="text-link"([^>]*)>[\s\S]*?<\/a>/, '<a class="text-link"$1>→</a>'),
      ),
  },
  {
    name: "a link says only click here",
    apply: (directory) =>
      edit(directory, HOME, (source) =>
        source.replace(/<a class="text-link"([^>]*)>[\s\S]*?<\/a>/, '<a class="text-link"$1>คลิกที่นี่</a>'),
      ),
  },
  {
    name: "an image loses its alt attribute",
    apply: (directory) => edit(directory, HOME, (source) => source.replace(/\salt="[^"]*"/, "")),
  },
  {
    name: "a form field ships with no label",
    apply: (directory) =>
      edit(directory, HOME, (source) =>
        source.replace("</main>", '<form><input type="text" name="q"><button>ส่ง</button></form></main>'),
      ),
  },
  {
    name: "a form ships with nowhere to announce an error",
    apply: (directory) =>
      edit(directory, HOME, (source) =>
        source.replace(
          "</main>",
          '<form><label for="q">คำค้น</label><input type="text" id="q" name="q"><button>ส่ง</button></form></main>',
        ),
      ),
  },
  {
    name: "the visible focus indicator is removed",
    apply: (directory) => edit(directory, CSS, (source) => source.replaceAll(":focus-visible", ":not(*)")),
  },
  {
    name: "the skip link never becomes visible when focused",
    apply: (directory) => edit(directory, CSS, (source) => source.replace(".skip-link:focus", ".skip-link-unused")),
  },
  {
    name: "the minimum touch target is dropped",
    apply: (directory) => edit(directory, CSS, (source) => source.replace("min-height: 48px", "min-height: 20px")),
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

function makeCopy() {
  const directory = mkdtempSync(join(tmpdir(), "nathee-a11y-"));
  cpSync(join(root, "public-site"), join(directory, "public-site"), { recursive: true });
  mkdirSync(join(directory, "scripts"), { recursive: true });
  return directory;
}

function runGate(directory) {
  return spawnSync(process.execPath, [gate], {
    env: { ...process.env, PUBLIC_ACCESSIBILITY_ROOT: directory },
    encoding: "utf8",
  });
}

let failures = 0;

const clean = makeCopy();
const cleanResult = runGate(clean);
if (cleanResult.status !== 0) {
  failures += 1;
  console.error(`PUBLIC_ACCESSIBILITY_NEGATIVE_FAIL unmodified release was rejected\n${cleanResult.stderr}`);
}
rmSync(clean, { recursive: true, force: true });

for (const testCase of CASES) {
  const directory = makeCopy();
  try {
    testCase.apply(directory);
    if (runGate(directory).status === 0) {
      failures += 1;
      console.error(`PUBLIC_ACCESSIBILITY_NEGATIVE_FAIL gate accepted: ${testCase.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`PUBLIC_ACCESSIBILITY_NEGATIVE_FAIL case failed to run: ${testCase.name}: ${error}`);
  }
  rmSync(directory, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log(`PUBLIC_ACCESSIBILITY_NEGATIVE_PASS rejections=${CASES.length} acceptances=1`);
