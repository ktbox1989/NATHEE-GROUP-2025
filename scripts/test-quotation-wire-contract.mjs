import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

// The public quotation form and the endpoint that stores the enquiry are owned
// by two different lanes, and they drift silently.
//
// Silently is the important word. Every mismatch between them fails in a way
// that looks like something else: a request key in the wrong shape is refused
// as `invalid`, which is indistinguishable from the customer mistyping their
// telephone number. A client bound looser than the server's is not refused at
// all — the server calls `slice()` and the end of what the customer wrote is
// gone, with nothing anywhere reporting a problem.
//
// So the alignment is asserted rather than assumed, on the four things that
// actually decide whether a submission survives: the request key, the field
// names, the bounds, and the failure codes.

const root = process.env.QUOTATION_WIRE_CONTRACT_ROOT
  ? resolve(process.env.QUOTATION_WIRE_CONTRACT_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");
const load = (path) => import(pathToFileURL(join(root, path)).href);
const failures = [];

function require(condition, message) {
  if (!condition) failures.push(message);
}

const SERVER_PARSER = "lib/quotation.ts";
const SERVER_ROUTE = "app/api/quotation/route.ts";
const SERVER_ATTACHMENTS = "lib/quotation-attachments.ts";
const CLIENT_CONTRACT = "lib/public-forms/quotation-contract.ts";

const parserSource = await read(SERVER_PARSER);
const routeSource = await read(SERVER_ROUTE);
const attachmentSource = await read(SERVER_ATTACHMENTS);

const client = await load(CLIENT_CONTRACT);
const server = await load(SERVER_PARSER);

// --- 1. the request key ----------------------------------------------------

// The server slices the `quote-` prefix off to use as the Turnstile idempotency
// key, so the prefix is load-bearing rather than decorative.
const keyPattern = parserSource.match(/if \(!(\/\^quote-.*?\/i)\.test\(requestKey\)\)/)?.[1];
require(keyPattern, `${SERVER_PARSER} no longer states a request-key pattern this gate can read`);

if (keyPattern) {
  // Rebuilt from the literal rather than evaluated: the gate compares patterns,
  // it does not need to run anything the source happens to contain.
  const [, body, flags] = keyPattern.match(/^\/(.*)\/([a-z]*)$/);
  const serverKeyPattern = new RegExp(body, flags);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const key = client.createRequestKey();
    require(serverKeyPattern.test(key), `createRequestKey produced "${key}", which the server refuses as invalid`);
    require(client.isWireRequestKey(key), `isWireRequestKey disagrees with the key it just made: "${key}"`);
  }
  // The client's own predicate must not be looser than the server's, or it
  // waves through keys the server will refuse.
  for (const rejected of ["", "abc", "a".repeat(32), crypto.randomUUID(), `quote-${"f".repeat(32)}`]) {
    require(
      client.isWireRequestKey(rejected) === serverKeyPattern.test(rejected),
      `isWireRequestKey and the server disagree about "${rejected}"`,
    );
  }
}

// --- 2. the field names ----------------------------------------------------

// Everything the server reads out of the multipart body.
const serverFields = new Set(
  [...parserSource.matchAll(/form\.get(?:All)?\("([a-zA-Z-]+)"\)/g)].map((match) => match[1]),
);
require(serverFields.size > 0, `${SERVER_PARSER} no longer reads any named form field`);

const built = client.buildQuotationFormData(
  {
    companyName: "บริษัท",
    contactName: "ผู้ติดต่อ",
    phone: "0631941191",
    lineId: "@nathee",
    email: "owner@natheegroup2025.com",
    origin: "กรุงเทพฯ",
    destination: "เชียงใหม่",
    quantity: "4",
    vehicleType: "MOTORCYCLE",
    desiredDate: "2026-09-01",
    extras: ["STORAGE"],
    notes: "หมายเหตุ",
    consent: true,
  },
  client.createRequestKey(),
);
const sentFields = new Set([...built.keys()]);

// The honeypot and the Turnstile token are read by the server but supplied by
// the widget or deliberately left empty, so they are checked separately below.
const TOKEN_FIELD = "cf-turnstile-response";
for (const field of serverFields) {
  if (field === TOKEN_FIELD) continue;
  require(sentFields.has(field), `the server reads "${field}" but the form never sends it`);
}
for (const field of sentFields) {
  require(serverFields.has(field), `the form sends "${field}" but the server never reads it, so it is discarded`);
}

// The honeypot must be present and empty: absent looks the same as filled to
// nothing, but an absent field cannot prove the form was rendered.
require(parserSource.includes('form.get("website")'), "the server no longer checks a honeypot named website");
require(built.get("website") === "", "the form must send an empty honeypot value");

// The consent literal is compared with ===, so "true" or a boolean is refused.
const consentLiteral = parserSource.match(/form\.get\("privacyConsent"\) !== "([a-z]+)"/)?.[1];
require(consentLiteral, "the server no longer compares privacyConsent against a literal");
require(
  built.get("privacyConsent") === consentLiteral,
  `the form sends privacyConsent="${built.get("privacyConsent")}" but the server requires "${consentLiteral}"`,
);

// --- 3. the bounds ---------------------------------------------------------

// The server truncates with slice() instead of rejecting, so a client bound
// looser than the server's is silent data loss.
const serverBounds = new Map(
  [...parserSource.matchAll(/(?:bounded|optional)\(form\.get\("([a-zA-Z]+)"\), (\d+)\)/g)].map((match) => [
    match[1],
    Number(match[2]),
  ]),
);
require(serverBounds.size > 0, `${SERVER_PARSER} no longer states any field bound this gate can read`);

for (const [field, serverMax] of serverBounds) {
  const clientMax = client.QUOTATION_LIMITS[field]?.max;
  if (clientMax === undefined) continue; // requestKey and the honeypot are not typed by a person
  require(
    clientMax === serverMax,
    `${field}: the form allows ${clientMax} characters, the server keeps ${serverMax} and silently drops the rest`,
  );
}

const quantityBounds = parserSource.match(/quantity < ([\d_]+) \|\| quantity > ([\d_]+)/);
require(quantityBounds, "the server no longer states a quantity range this gate can read");
if (quantityBounds) {
  const [, min, max] = quantityBounds.map((value) => Number(String(value).replaceAll("_", "")));
  require(
    client.QUOTATION_LIMITS.quantity.min === min && client.QUOTATION_LIMITS.quantity.max === max,
    `quantity: the form accepts ${client.QUOTATION_LIMITS.quantity.min}..${client.QUOTATION_LIMITS.quantity.max}, ` +
      `the server accepts ${min}..${max}`,
  );
}

// Enumerations are compared as values, not as text, so a reordering is fine and
// an added or removed member is not.
require(
  JSON.stringify([...client.QUOTATION_VEHICLE_TYPES].sort()) ===
    JSON.stringify([...server.QUOTATION_VEHICLE_TYPES].sort()),
  "the vehicle types offered by the form are not the ones the server stores",
);
require(
  JSON.stringify([...client.QUOTATION_EXTRAS].sort()) === JSON.stringify([...server.QUOTATION_EXTRAS].sort()),
  "the service extras offered by the form are not the ones the server stores",
);

// --- 4. the failure codes --------------------------------------------------

const codes = new Set();
for (const match of routeSource.matchAll(/redirect\(request, "error", ([^)]+)\)/g)) {
  for (const literal of match[1].matchAll(/"([a-z_]+)"/g)) {
    // request_too_large is the internal reason, not a code the browser sees.
    if (literal[1] !== "request_too_large") codes.add(literal[1]);
  }
}
// `parsed.error` and `attachmentResult.error` are forwarded verbatim, so their
// unions are part of the wire contract too.
for (const source of [parserSource, attachmentSource]) {
  const union = source.match(/error: ((?:"[a-z_]+"(?: \| )?)+)/)?.[1] ?? "";
  for (const literal of union.matchAll(/"([a-z_]+)"/g)) codes.add(literal[1]);
}
require(codes.size >= 8, `only ${codes.size} failure codes were found; the scan is misconfigured`);

const answered = new Set(client.QUOTATION_SERVER_ERROR_CODES);
for (const code of codes) {
  require(answered.has(code), `the server can answer with "${code}" and the form has no message for it`);
}
for (const code of answered) {
  require(codes.has(code), `the form answers "${code}", which the server can no longer emit`);
}

// A success is never inferred from a failure code, whatever else the URL says.
for (const code of codes) {
  const state = client.reduceSubmission(
    { httpStatus: 200, finalUrl: `https://app.natheegroup2025.com/quotation?error=${code}&submitted=QT-2026-000001` },
    client.createRequestKey(),
  );
  require(state.status === "ERROR", `"${code}" alongside a reference was read as ${state.status}`);
}

// --- 5. success needs the reference the server actually allocates -----------

const referenceFormat = routeSource.includes('nextBusinessNumber("QT")');
require(referenceFormat, "the endpoint no longer allocates a QT business number");
const success = client.reduceSubmission(
  { httpStatus: 303, finalUrl: "/quotation?submitted=QT-2026-000042" },
  client.createRequestKey(),
);
require(success.status === "SUCCESS", "the server's own success redirect was not accepted");
for (const notAReference of ["", "ok", "QT-1", "true"]) {
  const state = client.reduceSubmission(
    { httpStatus: 200, finalUrl: `/quotation?submitted=${encodeURIComponent(notAReference)}` },
    client.createRequestKey(),
  );
  require(state.status === "ERROR", `"${notAReference}" was accepted as a request number`);
}
require(
  client.reduceSubmission({ httpStatus: 200, finalUrl: null }, client.createRequestKey()).status === "ERROR",
  "a bare 200 with no redirect was treated as success",
);

// --- 6. the origin the endpoint requires -----------------------------------

require(
  routeSource.includes("isSameOrigin(request)"),
  "the endpoint no longer restricts the origin, which changes where the form may live",
);
require(
  client.QUOTATION_ENDPOINT_REQUIRES_APP_ORIGIN === true,
  "the form no longer records that it must be served from the application origin",
);

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error("QUOTATION_WIRE_CONTRACT_FAIL");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `QUOTATION_WIRE_CONTRACT_PASS fields=${serverFields.size} bounds=${serverBounds.size} ` +
    `errorCodes=${codes.size} vehicleTypes=${client.QUOTATION_VEHICLE_TYPES.length} ` +
    `extras=${client.QUOTATION_EXTRAS.length} unmappable=${client.UNMAPPABLE_QUOTATION_FIELDS.length}`,
);
