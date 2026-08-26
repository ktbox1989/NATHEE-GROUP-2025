import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts/test-public-news-read-api.mjs");
const tracked = [
  "app/api/public/v1/news/route.ts",
  "app/api/public/v1/news/[slug]/route.ts",
  "app/sitemap.xml/route.ts",
  "lib/public-news-api-contract.ts",
  "lib/public-news-api-service.ts",
  "lib/public-news-selection.ts",
  "lib/public-news-sql.ts",
  "docs/PUBLIC_NEWS_READ_API.md",
];

function edit(directory, path, transform) {
  const target = join(directory, path);
  const before = readFileSync(target, "utf8").split("\r\n").join("\n");
  const after = transform(before);
  if (after === before) throw new Error(`mutation changed nothing: ${path}`);
  writeFileSync(target, after);
}

const cases = [
  {
    name: "latest publication event stops guarding the cursor list",
    apply: (directory) => edit(directory, "lib/public-news-sql.ts", (source) =>
      source.replace("export const PUBLISHED_POSTS_CURSOR_SQL", "export const PUBLISHED_POSTS_CURSOR_SQL").replace("WHERE latest.action = 'PUBLISH'\n    AND (", "WHERE 1 = 1\n    AND (")),
  },
  {
    name: "public service bypasses the PUBLISHED + PUBLIC media resolver",
    apply: (directory) => edit(directory, "lib/public-news-api-service.ts", (source) => source.replaceAll("resolvePublicMedia(", "resolvePrivateMedia(")),
  },
  {
    name: "an Authorization header widens public data",
    apply: (directory) => edit(directory, "lib/public-news-api-contract.ts", (source) => source.replace("const url = new URL(request.url);", "const elevated = request.headers.get(\"Authorization\");\n  const url = new URL(request.url);")),
  },
  {
    name: "the client limit becomes unbounded",
    apply: (directory) => edit(directory, "lib/public-news-api-contract.ts", (source) => source.replace("limit <= PUBLIC_NEWS_MAX_LIMIT", "limit <= Number.MAX_SAFE_INTEGER")),
  },
  {
    name: "a revision id leaks into the response",
    apply: (directory) => edit(directory, "lib/public-news-api-contract.ts", (source) => source.replace("slug: value.slug,", "revisionId: value.revisionId,\n    slug: value.slug,")),
  },
  {
    name: "the public route gains mutation handling",
    apply: (directory) => edit(directory, "app/api/public/v1/news/route.ts", (source) => `${source}\nexport async function POST(request: Request) { return GET(request); }\n`),
  },
  {
    name: "the service starts reading preview state",
    apply: (directory) => edit(directory, "lib/public-news-api-service.ts", (source) => `import { getPreview } from "@/lib/post-cms-preview";\n${source}`),
  },
  {
    name: "the sitemap stops sharing the published loader",
    apply: (directory) => edit(directory, "app/sitemap.xml/route.ts", (source) => source.replaceAll("loadPublishedNewsSelection", "loadSitemapPostsDirectly")),
  },
  {
    name: "stored posts bypass the public CMS mapper",
    apply: (directory) => edit(directory, "lib/public-news-api-service.ts", (source) => source.replaceAll("mapStoredPostToPublicPost(", "trustStoredPost(")),
  },
];

function makeCopy() {
  const directory = mkdtempSync(join(tmpdir(), "nathee-public-news-api-"));
  for (const path of tracked) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, path), target);
  }
  return directory;
}

function run(directory) {
  return spawnSync(process.execPath, [gate], {
    env: { ...process.env, PUBLIC_NEWS_READ_API_ROOT: directory },
    encoding: "utf8",
  });
}

let failures = 0;
const clean = makeCopy();
const cleanResult = run(clean);
if (cleanResult.status !== 0) {
  failures += 1;
  console.error(`PUBLIC_NEWS_READ_API_NEGATIVE_FAIL unmodified tree was rejected\n${cleanResult.stderr}`);
}
rmSync(clean, { recursive: true, force: true });

for (const testCase of cases) {
  const directory = makeCopy();
  try {
    testCase.apply(directory);
    if (run(directory).status === 0) {
      failures += 1;
      console.error(`PUBLIC_NEWS_READ_API_NEGATIVE_FAIL gate accepted: ${testCase.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`PUBLIC_NEWS_READ_API_NEGATIVE_FAIL case failed: ${testCase.name}: ${error}`);
  }
  rmSync(directory, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log(`PUBLIC_NEWS_READ_API_NEGATIVE_PASS rejections=${cases.length} acceptances=1`);
