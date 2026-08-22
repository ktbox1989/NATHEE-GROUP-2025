import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The failures this gate exists for are quiet ones: a publish that appears to
// succeed and does not reach the live page, and a draft that becomes reachable.
// Each case below is one of them.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts/test-cms-delivery-contract.mjs");

const TRACKED_TREES = ["app", "components", "lib"];

const CASES = [
  {
    name: "a public page rendering managed content stops being per-request",
    apply: (directory) =>
      edit(directory, "app/services/page.tsx", (source) =>
        source.replace('export const dynamic = "force-dynamic";', "export const revalidate = 3600;"),
      ),
  },
  {
    name: "the home page stops being per-request",
    apply: (directory) =>
      edit(directory, "app/page.tsx", (source) =>
        source.replace('export const dynamic = "force-dynamic";', ""),
      ),
  },
  {
    name: "a public page starts reading revisions directly",
    apply: (directory) =>
      edit(directory, "app/about/page.tsx", (source) =>
        source.replace(
          'import { getManagedPageContent',
          'import { sitePageRevisions } from "@/db/schema";\nimport { getManagedPageContent',
        ),
      ),
  },
  {
    name: "the public helper stops requiring a published state",
    apply: (directory) =>
      edit(directory, "lib/cms-public-route.ts", (source) =>
        source.replaceAll('state.status === "PUBLISHED"', "true"),
      ),
  },
  {
    name: "a hidden page falls back to default content instead of nothing",
    apply: (directory) =>
      edit(directory, "lib/cms-public-route.ts", (source) =>
        source.replaceAll('state.status === "HIDDEN"', "false"),
      ),
  },
  {
    name: "the live revision stops being the most recent publication event",
    apply: (directory) =>
      edit(directory, "lib/site-cms.ts", (source) =>
        source.replace("desc(sitePagePublicationEvents.createdAt)", "asc(sitePagePublicationEvents.createdAt)"),
      ),
  },
  {
    name: "a hide event stops winning when it is the most recent",
    apply: (directory) =>
      edit(directory, "lib/site-cms.ts", (source) => source.replace('event.action === "HIDE"', "false")),
  },
  {
    name: "the protected tree becomes indexable, exposing drafts to crawlers",
    apply: (directory) =>
      edit(directory, "app/app/layout.tsx", (source) =>
        source.replace("robots: { index: false, follow: false }", "robots: { index: true, follow: true }"),
      ),
  },
  {
    name: "preview stops requiring an authenticated actor",
    apply: (directory) =>
      edit(directory, "app/app/site-content/[slug]/preview/page.tsx", (source) =>
        source.replace("requireActor(", "assumeActor("),
      ),
  },
  {
    name: "preview stops requiring the site read capability",
    apply: (directory) =>
      edit(directory, "app/app/site-content/[slug]/preview/page.tsx", (source) =>
        source.replace('can(actor, "site:read")', "true"),
      ),
  },
  {
    name: "preview stops scoping the revision to its own page",
    apply: (directory) =>
      edit(directory, "app/app/site-content/[slug]/preview/page.tsx", (source) =>
        source.replace("eq(sitePageRevisions.pageId, page.id)", "undefined"),
      ),
  },
  {
    name: "a preview stops being marked as an unpublished draft",
    apply: (directory) =>
      edit(directory, "components/cms-public-page.tsx", (source) =>
        source.replace("ตัวอย่างฉบับร่าง — ยังไม่เผยแพร่", "ตัวอย่าง"),
      ),
  },
];

function edit(directory, relativePath, transform) {
  const target = join(directory, relativePath);
  // Normalise to LF first: every anchor below is written with "\n", and on a
  // CRLF checkout the replacement would silently become a no-op.
  const original = readFileSync(target, "utf8").split("\r\n").join("\n");
  const next = transform(original);
  if (next === original) throw new Error(`mutation changed nothing: ${relativePath}`);
  writeFileSync(target, next);
}

function makeCopy() {
  const directory = mkdtempSync(join(tmpdir(), "nathee-cms-delivery-"));
  for (const tree of TRACKED_TREES) {
    cpSync(join(root, tree), join(directory, tree), { recursive: true });
  }
  mkdirSync(join(directory, "scripts"), { recursive: true });
  return directory;
}

function runGate(directory) {
  return spawnSync(process.execPath, [gate], {
    env: { ...process.env, CMS_DELIVERY_CONTRACT_ROOT: directory },
    encoding: "utf8",
  });
}

let failures = 0;

const clean = makeCopy();
const cleanResult = runGate(clean);
if (cleanResult.status !== 0) {
  failures += 1;
  console.error(`CMS_DELIVERY_NEGATIVE_FAIL unmodified tree was rejected\n${cleanResult.stderr}`);
}
rmSync(clean, { recursive: true, force: true });

for (const testCase of CASES) {
  const directory = makeCopy();
  try {
    testCase.apply(directory);
    if (runGate(directory).status === 0) {
      failures += 1;
      console.error(`CMS_DELIVERY_NEGATIVE_FAIL gate accepted: ${testCase.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`CMS_DELIVERY_NEGATIVE_FAIL case failed to run: ${testCase.name}: ${error}`);
  }
  rmSync(directory, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log(`CMS_DELIVERY_NEGATIVE_PASS rejections=${CASES.length} acceptances=1`);
