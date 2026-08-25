import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A gate that cannot fail proves nothing. Each case below is a specific way the
// news routes could stop being safe, applied to a copy of the tree; the gate has
// to reject every one of them and accept the tree as it stands.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts/test-public-news-contract.mjs");

const TRACKED_TREES = ["app", "components", "lib"];

const INDEX_ROUTE = "app/news/page.tsx";
const ARTICLE_ROUTE = "app/news/[slug]/page.tsx";
const READER = "lib/public-news.ts";
const CONTENT = "lib/public-news-content.ts";
const SQL = "lib/public-news-sql.ts";

const CASES = [
  {
    name: "the news index stops being per-request, so a publish never reaches it",
    apply: (directory) =>
      edit(directory, INDEX_ROUTE, (source) =>
        source.replace('export const dynamic = "force-dynamic";', "export const revalidate = 3600;"),
      ),
  },
  {
    name: "an article stops being per-request",
    apply: (directory) =>
      edit(directory, ARTICLE_ROUTE, (source) => source.replace('export const dynamic = "force-dynamic";', "")),
  },
  {
    name: "the index starts reading revisions directly",
    apply: (directory) =>
      edit(directory, INDEX_ROUTE, (source) =>
        source.replace('import Link from "next/link";', 'import { postRevisions } from "@/db/schema";\nimport Link from "next/link";'),
      ),
  },
  {
    name: "a hidden post stops disappearing from the index",
    apply: (directory) =>
      edit(directory, SQL, (source) => source.replace("WHERE latest.action = 'PUBLISH'", "WHERE 1 = 1")),
  },
  {
    name: "the live revision stops being the most recent publication event",
    apply: (directory) =>
      edit(directory, SQL, (source) => source.replaceAll("ORDER BY created_at DESC, id DESC", "ORDER BY created_at ASC, id ASC")),
  },
  {
    name: "publishedAt becomes the latest publication, re-dating corrected articles",
    apply: (directory) =>
      edit(directory, SQL, (source) => source.replace("MIN(created_at) AS first_published", "MAX(created_at) AS first_published")),
  },
  {
    name: "an outage starts reading as an empty archive",
    apply: (directory) =>
      edit(directory, READER, (source) => source.replace("unavailable: true", "unavailable: false")),
  },
  {
    name: "an unpublished post renders instead of answering 404",
    apply: (directory) => edit(directory, ARTICLE_ROUTE, (source) => source.replaceAll("notFound()", "undefined")),
  },
  {
    name: "the route overrides the editor and indexes a NOINDEX post anyway",
    apply: (directory) =>
      edit(directory, ARTICLE_ROUTE, (source) => source.replace("index: indexable, follow: indexable", "index: true, follow: true")),
  },
  {
    name: "an unedited article starts claiming it was modified",
    apply: (directory) =>
      edit(directory, ARTICLE_ROUTE, (source) =>
        source.replace(
          "...(article.updatedAt ? { modifiedTime: article.updatedAt } : {}),",
          "modifiedTime: article.updatedAt ?? article.publishedAt,",
        ),
      ),
  },
  {
    name: "media starts being addressed by its private storage key",
    apply: (directory) =>
      edit(directory, CONTENT, (source) =>
        source.replace("return `/api/gallery/images/${encodeURIComponent(id)}?role=${role}`;", "return `/files/${id}?storageKey=${role}`;"),
      ),
  },
  {
    name: "a post starts showing gallery items that were never made public",
    apply: (directory) =>
      edit(directory, READER, (source) => source.replace('eq(galleryItems.visibility, "PUBLIC"),', "")),
  },
  {
    name: "a post starts showing gallery items that were never published",
    apply: (directory) =>
      edit(directory, READER, (source) => source.replace('eq(galleryItems.status, "PUBLISHED"),', "")),
  },
  {
    name: "the index stops paginating in SQL and reads the whole archive per request",
    apply: (directory) => edit(directory, SQL, (source) => source.replace("LIMIT ? OFFSET ?", "")),
  },
  {
    name: "the page number stops being bounded, so an offset can be anything",
    apply: (directory) => edit(directory, CONTENT, (source) => source.replaceAll("MAX_NEWS_PAGE", "PAGE_HINT")),
  },
  {
    name: "an image loses the dimensions that keep the article from reflowing",
    apply: (directory) =>
      edit(directory, INDEX_ROUTE, (source) => source.replace("            height={post.image.height ?? 480}\n", "")),
  },
];

function edit(directory, file, transform) {
  const path = join(directory, file);
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`the edit to ${file} changed nothing, so the case proves nothing`);
  writeFileSync(path, after);
}

function makeCopy() {
  const directory = mkdtempSync(join(tmpdir(), "nathee-public-news-"));
  for (const tree of TRACKED_TREES) {
    cpSync(join(root, tree), join(directory, tree), { recursive: true });
  }
  mkdirSync(join(directory, "scripts"), { recursive: true });
  return directory;
}

function runGate(directory) {
  return spawnSync(process.execPath, [gate], {
    env: { ...process.env, PUBLIC_NEWS_CONTRACT_ROOT: directory },
    encoding: "utf8",
  });
}

let failures = 0;

const clean = makeCopy();
const cleanResult = runGate(clean);
if (cleanResult.status !== 0) {
  failures += 1;
  console.error(`PUBLIC_NEWS_NEGATIVE_FAIL unmodified tree was rejected\n${cleanResult.stderr}`);
}
rmSync(clean, { recursive: true, force: true });

for (const testCase of CASES) {
  const directory = makeCopy();
  try {
    testCase.apply(directory);
    if (runGate(directory).status === 0) {
      failures += 1;
      console.error(`PUBLIC_NEWS_NEGATIVE_FAIL gate accepted: ${testCase.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`PUBLIC_NEWS_NEGATIVE_FAIL case failed to run: ${testCase.name}: ${error}`);
  }
  rmSync(directory, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log(`PUBLIC_NEWS_NEGATIVE_PASS rejections=${CASES.length} acceptances=1`);
