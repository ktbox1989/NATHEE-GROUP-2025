import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Both halves of the header contract have to be able to fail: the worker
// dropping a header or growing a second exit, and the application growing the
// markup the policy forbids.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts/test-response-security-headers.mjs");

const TRACKED_TREES = ["app", "components"];
const TRACKED_FILES = ["worker/index.ts", "lib/operational-qr-route.ts"];

const CASES = [
  {
    name: "the Content-Security-Policy header is dropped",
    apply: (directory) =>
      edit(directory, "worker/index.ts", (source) =>
        source.replace(
          'response.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);',
          "",
        ),
      ),
  },
  {
    name: "form-action is removed from the policy",
    apply: (directory) =>
      edit(directory, "worker/index.ts", (source) =>
        source.replace(" form-action 'self';", ""),
      ),
  },
  {
    name: "base-uri is removed from the policy",
    apply: (directory) =>
      edit(directory, "worker/index.ts", (source) =>
        source.replace("base-uri 'none'; ", ""),
      ),
  },
  {
    name: "Cross-Origin-Resource-Policy is dropped",
    apply: (directory) =>
      edit(directory, "worker/index.ts", (source) =>
        source.replace('response.headers.set("Cross-Origin-Resource-Policy", "same-origin");', ""),
      ),
  },
  {
    name: "nosniff is dropped",
    apply: (directory) =>
      edit(directory, "worker/index.ts", (source) =>
        source.replace('response.headers.set("X-Content-Type-Options", "nosniff");', ""),
      ),
  },
  {
    name: "HTTPS responses stop declaring Strict-Transport-Security",
    apply: (directory) =>
      edit(directory, "worker/index.ts", (source) =>
        source.replace('"Strict-Transport-Security"', '"X-Nathee-Transport"'),
      ),
  },
  {
    name: "a second exit is added to fetch(), bypassing the headers",
    apply: (directory) =>
      edit(directory, "worker/index.ts", (source) =>
        source.replace(
          "    return applySecurityHeaders(request, await route(request, env, ctx));",
          '    if (new URL(request.url).pathname === "/_debug") return new Response("ok");\n' +
            "    return applySecurityHeaders(request, await route(request, env, ctx));",
        ),
      ),
  },
  {
    name: "the single exit stops applying the headers",
    apply: (directory) =>
      edit(directory, "worker/index.ts", (source) =>
        source.replace(
          "return applySecurityHeaders(request, await route(request, env, ctx));",
          "return route(request, env, ctx);",
        ),
      ),
  },
  {
    name: "the rendered QR SVG loses its own strict policy",
    apply: (directory) =>
      edit(directory, "lib/operational-qr-route.ts", (source) =>
        source.replace("default-src 'none'; style-src 'unsafe-inline'; sandbox", "default-src *"),
      ),
  },
  {
    name: "a page grows a <base> tag",
    apply: (directory) =>
      edit(directory, "app/login/page.tsx", (source) =>
        source.replace("<main className=\"login-page\">", '<main className="login-page"><base href="/" />'),
      ),
  },
  {
    name: "a page grows an iframe of the application",
    apply: (directory) =>
      edit(directory, "app/login/page.tsx", (source) =>
        source.replace("<main className=\"login-page\">", '<main className="login-page"><iframe src="/app" />'),
      ),
  },
  {
    name: "a form starts posting off-site",
    apply: (directory) =>
      edit(directory, "app/login/page.tsx", (source) =>
        source.replace('action="/api/auth/login"', 'action="https://auth.example.test/login"'),
      ),
  },
  {
    name: "a form starts posting protocol-relative",
    apply: (directory) =>
      edit(directory, "app/login/page.tsx", (source) =>
        source.replace('action="/api/auth/login"', 'action="//auth.example.test/login"'),
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
  const directory = mkdtempSync(join(tmpdir(), "nathee-headers-"));
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
    env: { ...process.env, RESPONSE_HEADER_GATE_ROOT: directory },
    encoding: "utf8",
  });
}

let failures = 0;

const clean = makeCopy();
const cleanResult = runGate(clean);
if (cleanResult.status !== 0) {
  failures += 1;
  console.error(`RESPONSE_HEADER_NEGATIVE_FAIL unmodified tree was rejected\n${cleanResult.stderr}`);
}
rmSync(clean, { recursive: true, force: true });

for (const testCase of CASES) {
  const directory = makeCopy();
  try {
    testCase.apply(directory);
    if (runGate(directory).status === 0) {
      failures += 1;
      console.error(`RESPONSE_HEADER_NEGATIVE_FAIL gate accepted: ${testCase.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`RESPONSE_HEADER_NEGATIVE_FAIL case failed to run: ${testCase.name}: ${error}`);
  }
  rmSync(directory, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log(`RESPONSE_HEADER_NEGATIVE_PASS rejections=${CASES.length} acceptances=1`);
