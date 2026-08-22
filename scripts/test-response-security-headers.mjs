import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Two halves of one contract.
//
// The worker must send the headers, on every response including the image
// optimizer, which used to return before they were applied. And the application
// must not contain the markup those headers forbid — a `<base>` tag or an
// off-site form action would be a page that works today and stops working the
// moment the policy is enforced. Asserting the policy without asserting
// compatibility is how a header gets quietly removed later "because it broke
// something".

const root = process.env.RESPONSE_HEADER_GATE_ROOT
  ? resolve(process.env.RESPONSE_HEADER_GATE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Line endings are normalised on read. A checkout on Windows holds CRLF, and
// an assertion that embeds a newline would otherwise fail there while passing
// here — a gate that depends on how the tree was checked out is not a gate.
const read = async (path) =>
  (await readFile(join(root, path), "utf8")).replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));
const failures = [];

function require(condition, message) {
  if (!condition) failures.push(message);
}

const REQUIRED_HEADERS = [
  ["Content-Security-Policy", "CONTENT_SECURITY_POLICY"],
  ["Cross-Origin-Resource-Policy", '"same-origin"'],
  ["Referrer-Policy", '"strict-origin-when-cross-origin"'],
  ["X-Content-Type-Options", '"nosniff"'],
  ["X-Frame-Options", '"DENY"'],
  ["Cross-Origin-Opener-Policy", '"same-origin"'],
];

const REQUIRED_CSP_DIRECTIVES = [
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

const worker = await read("worker/index.ts");

for (const [header, value] of REQUIRED_HEADERS) {
  require(
    worker.includes(`response.headers.set("${header}", ${value})`),
    `worker/index.ts: ${header} is not set to its required value`,
  );
}
for (const directive of REQUIRED_CSP_DIRECTIVES) {
  require(
    worker.includes(directive),
    `worker/index.ts: Content-Security-Policy is missing ${directive}`,
  );
}
require(
  worker.includes('response.headers.set(\n      "Strict-Transport-Security"'),
  "worker/index.ts: HTTPS responses must declare Strict-Transport-Security",
);

// fetch() must have exactly one exit, and it must go through the header
// function. Any second return is a response that can leave without headers, so
// the count is the check rather than an inspection of each branch.
const fetchStart = worker.indexOf("async fetch(request: Request");
const fetchEnd = worker.indexOf("async function route(", fetchStart);
require(fetchStart >= 0 && fetchEnd > fetchStart, "worker/index.ts: fetch() and route() are not in their expected shape");
const fetchBody = worker.slice(fetchStart, fetchEnd);
// Counted anywhere in the body, not only at the start of a line: an early exit
// tucked after an `if` on one line is exactly the bypass this is looking for.
const returnCount = fetchBody.split("return").length - 1;
require(
  returnCount === 1,
  `worker/index.ts: fetch() must have exactly one exit, found ${returnCount}`,
);
require(
  fetchBody.includes("return applySecurityHeaders(request, await route(request, env, ctx));"),
  "worker/index.ts: the single exit must apply the security headers",
);

// The QR endpoint serves attacker-influenceable SVG and keeps its own far
// stricter policy; the blanket one must not be mistaken for that.
const qrRoute = await read("lib/operational-qr-route.ts");
require(
  qrRoute.includes("default-src 'none'") && qrRoute.includes("sandbox"),
  "lib/operational-qr-route.ts: rendered SVG must keep its own strict policy",
);

async function walk(directory) {
  const absolute = join(root, directory);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const child = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) files.push(child);
  }
  return files;
}

const sources = (await Promise.all(["app", "components"].map(walk)))
  .flat()
  .map((path) => path.split(sep).join("/"))
  .sort();
require(sources.length > 0, "no application sources were found; the scan is misconfigured");

// Markup the declared policy forbids.
const FORBIDDEN_ELEMENTS = [
  [/<base[\s>]/i, "a <base> tag would be blocked by base-uri 'none'"],
  [/<object[\s>]/i, "an <object> would be blocked by object-src 'none'"],
  [/<embed[\s>]/i, "an <embed> would be blocked by object-src 'none'"],
  [/<iframe[\s>]/i, "an <iframe> of this application would be blocked by frame-ancestors 'none'"],
];

for (const path of sources) {
  const source = await read(path);
  for (const [pattern, reason] of FORBIDDEN_ELEMENTS) {
    require(!pattern.test(source), `${path}: ${reason}`);
  }
  // form-action 'self': every form target must be same-origin. A relative path
  // qualifies; an absolute or protocol-relative URL does not. Values that are
  // neither (hidden-input action names such as "PUBLISH") are not form targets.
  for (const match of source.matchAll(/\b(?:action|formAction)=(?:"([^"]*)"|\{"([^"]*)"\})/g)) {
    const value = match[1] ?? match[2] ?? "";
    require(
      !/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value),
      `${path}: form submits to '${value}', which form-action 'self' forbids`,
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`RESPONSE_HEADER_GATE_FAIL ${failure}`);
  process.exit(1);
}

console.log(
  `RESPONSE_HEADER_GATE_PASS headers=${REQUIRED_HEADERS.length} cspDirectives=${REQUIRED_CSP_DIRECTIVES.length} sourcesScanned=${sources.length} exemptResponses=0`,
);
