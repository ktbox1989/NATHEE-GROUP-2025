import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { can, isInternalRole } from "../lib/authorization.ts";
import {
  createOpaquePublicId,
  isOperationalPublicId,
  OPERATIONAL_QR_ENTITY_TYPES,
  parseOperationalQrToken,
} from "../lib/qr.ts";

// A QR code is printed on a sticker and photographed by anyone who walks past a
// motorcycle. Two things therefore have to hold: the code itself must carry no
// customer data, and scanning it must reveal nothing to someone who is not
// entitled to that record.

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
const APP = fileURLToPath(new URL("../app/", import.meta.url));

const CUSTOMER_A = { userId: "user-a", role: "CUSTOMER_VIEWER", companyId: "company-a", permissions: [] };
const CUSTOMER_B = { userId: "user-b", role: "CUSTOMER_VIEWER", companyId: "company-b", permissions: [] };
const OWNER = { userId: "user-owner", role: "OWNER", companyId: null, permissions: [] };
const STAFF = { userId: "user-staff", role: "STAFF", companyId: null, permissions: ["motorcycles:read", "jobs:read", "yard:read"] };

function migrated() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${directory}/${name}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name) VALUES
      ('company-a', 'CUS-A', 'บริษัท เอ จำกัด', 'บริษัท เอ'),
      ('company-b', 'CUS-B', 'บริษัท บี จำกัด', 'บริษัท บี');
    INSERT INTO users (id, external_auth_id, email, display_name, role, company_id, status) VALUES
      ('user-owner', 'auth-o', 'o@example.test', 'Owner', 'OWNER', NULL, 'ACTIVE'),
      ('user-a', 'auth-a', 'a@example.test', 'A', 'CUSTOMER', 'company-a', 'ACTIVE'),
      ('user-b', 'auth-b', 'b@example.test', 'B', 'CUSTOMER', 'company-b', 'ACTIVE');
    INSERT INTO yard_zones (id, public_id, code, name, status, created_by)
      VALUES ('zone-1', 'yard_11111111111111111111111111111111', 'A-01', 'โซน A', 'ACTIVE', 'user-owner');
    INSERT INTO trucks (id, request_key, public_id, code, registration, type, status, created_by)
      VALUES ('truck-1', 'req-truck-1', 'truck_11111111111111111111111111111111', 'TRK-01', '70-1234', 'SIX_WHEEL', 'ACTIVE', 'user-owner');
  `);
  for (const [suffix, hex] of [["a", "a"], ["b", "b"]]) {
    const pad = hex.repeat(32);
    db.exec(`
      INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by)
      VALUES ('job-${suffix}', 'job_${pad}', 'JOB-2026-00000${suffix === "a" ? 1 : 2}', 'company-${suffix}', 'กรุงเทพฯ', 'เชียงใหม่', 'OPEN', 'user-owner');
      INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, vin, engine_number, current_status)
      VALUES ('mc-${suffix}', 'mc_${pad}', 'company-${suffix}', 'job-${suffix}', 1, 'VINSECRET${suffix.toUpperCase()}12345', 'ENGSECRET${suffix.toUpperCase()}', 'IN_YARD');
    `);
  }
  return db;
}

/** Mirrors lib/operational-qr-route.ts and the motorcycle QR route. */
function qrVerdict(db, entityType, publicId, actor) {
  if (!actor) return "unauthorized";
  if (!isOperationalPublicId(entityType, publicId)) return "not-found";

  if (entityType === "motorcycle") {
    const row = db.prepare("SELECT company_id FROM motorcycles WHERE public_id = ?").get(publicId);
    return row && can(actor, "motorcycles:read", row.company_id) ? "rendered" : "not-found";
  }
  if (entityType === "job") {
    const row = db.prepare("SELECT company_id FROM transport_jobs WHERE public_id = ?").get(publicId);
    return row && can(actor, "jobs:read", row.company_id) ? "rendered" : "not-found";
  }
  // Yard, truck and trip are internal operational assets.
  if (!isInternalRole(actor.role)) return "not-found";
  const table = entityType === "yard" ? "yard_zones" : entityType === "truck" ? "trucks" : "trips";
  const row = db.prepare(`SELECT id FROM ${table} WHERE public_id = ?`).get(publicId);
  const permission = entityType === "yard" ? "yard:read" : "jobs:read";
  return row && can(actor, permission) ? "rendered" : "not-found";
}

test("an operational identity carries no customer data at all", () => {
  const db = migrated();
  const secrets = db
    .prepare("SELECT public_id, vin, engine_number, company_id, id FROM motorcycles")
    .all();
  for (const row of secrets) {
    assert.match(row.public_id, /^mc_[a-f0-9]{32}$/);
    for (const secret of [row.vin, row.engine_number, row.company_id, row.id]) {
      assert.ok(
        !row.public_id.includes(secret),
        `the printed identity leaks ${secret}`,
      );
    }
    // And nothing recognisable as a plate, VIN fragment or company name.
    assert.ok(!/VIN|ENG|SECRET|company/i.test(row.public_id));
  }
  db.close();
});

test("a freshly minted identity is unguessable and type-tagged", () => {
  const seen = new Set();
  for (const entityType of OPERATIONAL_QR_ENTITY_TYPES) {
    for (let index = 0; index < 50; index += 1) {
      const id = createOpaquePublicId(entityType);
      assert.equal(isOperationalPublicId(entityType, id), true, id);
      assert.ok(!seen.has(id), "identities must not repeat");
      seen.add(id);
      // A motorcycle identity must not validate as a yard identity.
      for (const other of OPERATIONAL_QR_ENTITY_TYPES) {
        if (other !== entityType) assert.equal(isOperationalPublicId(other, id), false);
      }
    }
  }
});

test("an unauthenticated scan reveals nothing, whatever it scans", () => {
  const db = migrated();
  for (const [entityType, publicId] of [
    ["motorcycle", `mc_${"a".repeat(32)}`],
    ["job", `job_${"a".repeat(32)}`],
    ["yard", "yard_11111111111111111111111111111111"],
    ["truck", "truck_11111111111111111111111111111111"],
  ]) {
    assert.equal(qrVerdict(db, entityType, publicId, null), "unauthorized", entityType);
  }
  db.close();
});

test("a customer cannot render another company's vehicle or job code", () => {
  const db = migrated();
  const own = `mc_${"a".repeat(32)}`;
  const foreign = `mc_${"b".repeat(32)}`;
  assert.equal(qrVerdict(db, "motorcycle", own, CUSTOMER_A), "rendered");
  assert.equal(qrVerdict(db, "motorcycle", foreign, CUSTOMER_A), "not-found");
  assert.equal(qrVerdict(db, "motorcycle", foreign, CUSTOMER_B), "rendered");

  assert.equal(qrVerdict(db, "job", `job_${"a".repeat(32)}`, CUSTOMER_A), "rendered");
  assert.equal(qrVerdict(db, "job", `job_${"b".repeat(32)}`, CUSTOMER_A), "not-found");
  db.close();
});

test("a refusal is indistinguishable from a code that does not exist", () => {
  const db = migrated();
  // Both answer "not found", so a scanner cannot enumerate which identities are
  // real by watching for a different refusal.
  assert.equal(qrVerdict(db, "motorcycle", `mc_${"b".repeat(32)}`, CUSTOMER_A), "not-found");
  assert.equal(qrVerdict(db, "motorcycle", `mc_${"c".repeat(32)}`, CUSTOMER_A), "not-found");
  db.close();
});

test("internal operational codes are never resolvable by a customer", () => {
  const db = migrated();
  for (const [entityType, publicId] of [
    ["yard", "yard_11111111111111111111111111111111"],
    ["truck", "truck_11111111111111111111111111111111"],
  ]) {
    // Not even for a customer whose own vehicles are in that yard.
    assert.equal(qrVerdict(db, entityType, publicId, CUSTOMER_A), "not-found", entityType);
    assert.equal(qrVerdict(db, entityType, publicId, OWNER), "rendered", entityType);
  }
  // Staff resolve them only with the matching capability.
  assert.equal(qrVerdict(db, "yard", "yard_11111111111111111111111111111111", STAFF), "rendered");
  assert.equal(
    qrVerdict(db, "yard", "yard_11111111111111111111111111111111", { ...STAFF, permissions: ["jobs:read"] }),
    "not-found",
  );
  db.close();
});

test("a malformed or cross-type code is refused before any lookup", () => {
  const db = migrated();
  for (const bad of ["", "mc_", "mc_ZZZZ", `mc_${"a".repeat(31)}`, `mc_${"a".repeat(33)}`, "'; DROP TABLE motorcycles; --"]) {
    assert.equal(qrVerdict(db, "motorcycle", bad, OWNER), "not-found", bad);
  }
  // A job identity presented as a motorcycle identity.
  assert.equal(qrVerdict(db, "motorcycle", `job_${"a".repeat(32)}`, OWNER), "not-found");
  db.close();
});

test("a scanned token resolves to its own entity type and nothing else", () => {
  for (const entityType of OPERATIONAL_QR_ENTITY_TYPES) {
    const id = createOpaquePublicId(entityType);
    const parsed = parseOperationalQrToken(id);
    assert.equal(parsed?.entityType, entityType);
    assert.equal(parsed?.publicId, id);
  }
  for (const junk of ["", " ", "NATHEE:MC:", "NATHEE:MC:mc_zzz", `mc_${"a".repeat(32)} `, "x".repeat(200)]) {
    assert.equal(parseOperationalQrToken(junk), null, JSON.stringify(junk));
  }
});

test("print surfaces demand a write capability, not merely the ability to look", () => {
  // A customer may read their own motorcycle but must not be able to print its
  // operational label, which is an internal artefact.
  assert.equal(can(CUSTOMER_A, "motorcycles:read", "company-a"), true);
  assert.equal(can(CUSTOMER_A, "motorcycles:write", "company-a"), false);
  assert.equal(can(CUSTOMER_A, "jobs:write", "company-a"), false);
  assert.equal(can(OWNER, "motorcycles:write", "company-a"), true);
});

// These mirror route logic, which goes stale silently.
test("the QR and print routes still scope the way these cases assume", () => {
  const cases = [
    ["api/qr/motorcycles/[publicId]/route.ts", 'can(actor, "motorcycles:read", record.companyId)'],
    ["app/motorcycles/[id]/label/page.tsx", 'can(actor, "motorcycles:write", record.companyId)'],
    ["app/jobs/[id]/label/page.tsx", 'can(actor, "jobs:write", job.companyId)'],
    ["app/trips/[id]/label/page.tsx", "isInternalRole(actor.role)"],
    ["app/trucks/[id]/label/page.tsx", "isInternalRole(actor.role)"],
    ["app/yard/[id]/label/page.tsx", 'can(actor, "yard:write")'],
  ];
  for (const [file, needle] of cases) {
    const source = readFileSync(`${APP}${file}`, "utf8");
    assert.ok(source.includes(needle), `${file} no longer contains '${needle}'`);
  }
  const shared = readFileSync(fileURLToPath(new URL("../lib/operational-qr-route.ts", import.meta.url)), "utf8");
  assert.ok(shared.includes('if (!actor) return new Response("Unauthorized", { status: 401 })'));
  assert.ok(shared.includes("isInternalRole(actor.role)"), "yard, truck and trip must stay internal-only");
});
