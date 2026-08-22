import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The leak this prevents is quiet in both directions: an unauthorized read
// returns bytes and looks like a working feature, and a shareable cache header
// publishes a customer's evidence to whoever asks the CDN next while every log
// line stays green. Each case below is one of those.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts/test-private-media-contract.mjs");

const TRACKED_TREES = ["app", "lib"];
const TRACKED_FILES = [".openai/hosting.json", "docs/DEPLOYMENT_ARCHITECTURE.md"];

const CASES = [
  {
    name: "private evidence is read without deciding who is asking",
    apply: (directory) =>
      edit(directory, "app/api/images/[id]/route.ts", (source) =>
        source
          .replaceAll("getCurrentActor(", "assumeActor(")
          .replaceAll("can(actor,", "skipCan(actor,")
          .replaceAll("actor.role", "SKIPPED_ROLE"),
      ),
  },
  {
    name: "a recipient signature is read without an authorization decision",
    apply: (directory) =>
      edit(directory, "app/api/pod-signatures/[id]/route.ts", (source) =>
        source.replaceAll("getCurrentActor(", "assumeActor(").replaceAll("can(actor,", "skipCan(actor,"),
      ),
  },
  {
    name: "a quotation attachment stops being Owner-only",
    apply: (directory) =>
      edit(directory, "app/api/quotation/[id]/attachments/[attachmentId]/route.ts", (source) =>
        source
          .replaceAll("getCurrentActor(", "assumeActor(")
          .replaceAll('actor.role !== "OWNER"', "false")
          .replaceAll("can(actor,", "skipCan(actor,"),
      ),
  },
  {
    name: "private evidence becomes cacheable by a shared cache",
    apply: (directory) =>
      edit(directory, "app/api/images/[id]/route.ts", (source) =>
        source.replace('"Cache-Control": "private, no-store"', '"Cache-Control": "public, max-age=3600"'),
      ),
  },
  {
    name: "the gallery route marks every image shareable, published or not",
    apply: (directory) =>
      edit(directory, "app/api/gallery/images/[id]/route.ts", (source) =>
        source.replace(
          '"Cache-Control": isPublic ? "public, max-age=3600, stale-while-revalidate=86400" : "private, no-store"',
          '"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"',
        ),
      ),
  },
  {
    name: "'public' stops meaning PUBLISHED and PUBLIC",
    apply: (directory) =>
      edit(directory, "app/api/gallery/images/[id]/route.ts", (source) =>
        source.replace(
          'const isPublic = item.status === "PUBLISHED" && item.visibility === "PUBLIC";',
          "const isPublic = true;",
        ),
      ),
  },
  {
    name: "the public quotation intake loses its anti-abuse challenge",
    apply: (directory) =>
      edit(directory, "app/api/quotation/route.ts", (source) =>
        source.replaceAll("verifyTurnstile(", "skipTurnstile("),
      ),
  },
  {
    name: "the public quotation intake loses its request bound",
    apply: (directory) =>
      edit(directory, "app/api/quotation/route.ts", (source) =>
        source.replaceAll("validateBoundedMultipartRequest(", "skipBounds("),
      ),
  },
  {
    name: "the public quotation intake loses its same-origin check",
    apply: (directory) =>
      edit(directory, "app/api/quotation/route.ts", (source) =>
        source.replace("isSameOrigin(request)", "true"),
      ),
  },
  {
    name: "the readiness probe starts reading real objects",
    apply: (directory) =>
      edit(directory, "app/api/health/route.ts", (source) =>
        source.replace('env.FILES.head("__nathee_runtime_readiness_probe__")', 'env.FILES.get("evidence/any.jpg")'),
      ),
  },
  {
    name: "a new route writes to storage with no authorization at all",
    apply: (directory) =>
      write(
        directory,
        "app/api/exports/route.ts",
        `import { env } from "cloudflare:workers";\n` +
          `export async function POST(request: Request) {\n` +
          `  await env.FILES.put("exports/all.zip", await request.arrayBuffer());\n` +
          `  return new Response("ok");\n` +
          `}\n`,
      ),
  },
  {
    name: "the private bucket binding is renamed away",
    apply: (directory) =>
      edit(directory, ".openai/hosting.json", (source) => source.replace('"FILES"', '"PUBLIC_FILES"')),
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

function write(directory, relativePath, contents) {
  const target = join(directory, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function makeCopy() {
  const directory = mkdtempSync(join(tmpdir(), "nathee-private-media-"));
  for (const tree of TRACKED_TREES) {
    cpSync(join(root, tree), join(directory, tree), { recursive: true });
  }
  for (const file of TRACKED_FILES) {
    const target = join(directory, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, file), target);
  }
  return directory;
}

function runGate(directory) {
  return spawnSync(process.execPath, [gate], {
    env: { ...process.env, PRIVATE_MEDIA_CONTRACT_ROOT: directory },
    encoding: "utf8",
  });
}

let failures = 0;

const clean = makeCopy();
const cleanResult = runGate(clean);
if (cleanResult.status !== 0) {
  failures += 1;
  console.error(`PRIVATE_MEDIA_NEGATIVE_FAIL unmodified tree was rejected\n${cleanResult.stderr}`);
}
rmSync(clean, { recursive: true, force: true });

for (const testCase of CASES) {
  const directory = makeCopy();
  try {
    testCase.apply(directory);
    if (runGate(directory).status === 0) {
      failures += 1;
      console.error(`PRIVATE_MEDIA_NEGATIVE_FAIL gate accepted: ${testCase.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`PRIVATE_MEDIA_NEGATIVE_FAIL case failed to run: ${testCase.name}: ${error}`);
  }
  rmSync(directory, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log(`PRIVATE_MEDIA_NEGATIVE_PASS rejections=${CASES.length} acceptances=1`);
