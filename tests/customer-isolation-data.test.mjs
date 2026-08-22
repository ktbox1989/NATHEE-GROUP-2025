import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { can, isCustomerRole } from "../lib/authorization.ts";

// tests/customer-isolation.test.ts proves two things about the shape of the
// code: that can() denies customers across companies, and that every route
// touching company-owned data calls *some* authorization check.
//
// Neither proves the check is handed the company that actually owns the row
// being returned. `can(actor, "documents:read", actor.companyId)` passes that
// static scan and always succeeds — it is the exact shape a cross-tenant leak
// takes. So this file is behavioural: two real companies with real rows in a
// real migrated database, walked through the real can(), one surface at a time.

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
const APP_ROOT = fileURLToPath(new URL("../app/", import.meta.url));

const CUSTOMER_A = { userId: "user-customer-a", role: "CUSTOMER_VIEWER", companyId: "company-a", permissions: [] };
const CUSTOMER_B = { userId: "user-customer-b", role: "CUSTOMER_VIEWER", companyId: "company-b", permissions: [] };
const OWNER = { userId: "user-owner", role: "OWNER", companyId: null, permissions: [] };

function migrated() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${directory}/${name}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  return db;
}

/** Two companies, each with a complete operational record of its own. */
function seedTwoCompanies(db) {
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name) VALUES
      ('company-a', 'CUS-A', 'บริษัท เอ จำกัด', 'บริษัท เอ'),
      ('company-b', 'CUS-B', 'บริษัท บี จำกัด', 'บริษัท บี');
    INSERT INTO users (id, external_auth_id, email, display_name, role, company_id, status) VALUES
      ('user-owner', 'auth-owner', 'owner@example.test', 'Owner', 'OWNER', NULL, 'ACTIVE'),
      ('user-customer-a', 'auth-a', 'a@example.test', 'ลูกค้า A', 'CUSTOMER', 'company-a', 'ACTIVE'),
      ('user-customer-b', 'auth-b', 'b@example.test', 'ลูกค้า B', 'CUSTOMER', 'company-b', 'ACTIVE');
    INSERT INTO gallery_categories (id, slug, name, status, created_by)
      VALUES ('cat-work', 'work', 'งานจริง', 'ACTIVE', 'user-owner');
    INSERT INTO yard_zones (id, public_id, code, name, status, created_by) VALUES
      ('zone-1', 'yard_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'A-01', 'โซน A', 'ACTIVE', 'user-owner');
  `);

  for (const suffix of ["a", "b"]) {
    const company = `company-${suffix}`;
    db.exec(`
      INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by)
      VALUES ('job-${suffix}', 'job_${suffix.repeat(32).slice(0, 32)}', 'JOB-2026-00000${suffix === "a" ? 1 : 2}', '${company}', 'กรุงเทพฯ', 'เชียงใหม่', 'OPEN', 'user-owner');

      INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, vin, engine_number, current_status)
      VALUES ('mc-${suffix}', 'mc_public_${suffix}', '${company}', 'job-${suffix}', 1, 'VIN-${suffix}', 'ENG-${suffix}', 'IN_YARD');

      INSERT INTO status_events (id, motorcycle_id, company_id, previous_status, new_status, note, created_by)
      VALUES ('evt-${suffix}', 'mc-${suffix}', '${company}', NULL, 'IN_YARD', 'รับเข้าลาน', 'user-owner');

      INSERT INTO motorcycle_images (id, request_key, motorcycle_id, company_id, category, storage_key, content_type, byte_size, checksum, uploaded_by)
      VALUES ('img-${suffix}', 'req-img-${suffix}', 'mc-${suffix}', '${company}', 'FRONT', 'evidence/${suffix}.jpg', 'image/jpeg', 1024, '${suffix.repeat(64).slice(0, 64)}', 'user-owner');

      INSERT INTO gallery_items (id, request_key, category_id, company_id, job_id, title, alt_text, status, visibility, uploaded_by)
      VALUES ('gal-${suffix}', 'req-gal-${suffix}', 'cat-work', '${company}', 'job-${suffix}', 'ภาพงาน ${suffix}', 'คำบรรยาย', 'DRAFT', 'CUSTOMER_JOB', 'user-owner');

      INSERT INTO yard_placements (id, request_key, motorcycle_id, company_id, yard_zone_id, entered_at, placed_by)
      VALUES ('yard-${suffix}', 'req-yard-${suffix}', 'mc-${suffix}', '${company}', 'zone-1', '2026-08-23T01:00:00.000Z', 'user-owner');

      INSERT INTO notifications (id, idempotency_key, recipient_user_id, company_id, source_event_id, type, severity, title, body, href)
      VALUES ('ntf-${suffix}', 'idem-${suffix}', 'user-customer-${suffix}', '${company}', 'evt-${suffix}', 'MOTORCYCLE_STATUS_CHANGED', 'INFO', 'สถานะเปลี่ยน', 'รถเข้าลานแล้ว', '/app/motorcycles/mc-${suffix}');
    `);
  }
  return db;
}

/**
 * The scope a list route applies. Mirrors, for example,
 * `app/app/motorcycles/page.tsx`:
 *   const scope = customerRole && actor.companyId ? eq(table.companyId, actor.companyId) : undefined
 */
function listScope(actor) {
  return isCustomerRole(actor.role) && actor.companyId ? actor.companyId : null;
}

function scopedList(db, table, actor) {
  const companyId = listScope(actor);
  return companyId
    ? db.prepare(`SELECT id, company_id FROM ${table} WHERE company_id = ? ORDER BY id`).all(companyId)
    : db.prepare(`SELECT id, company_id FROM ${table} ORDER BY id`).all();
}

/**
 * The detail pattern: fetch the row by id, then authorize against the company
 * the row actually belongs to. Returns what the route would serve.
 */
function fetchAndAuthorize(db, table, id, actor, permission) {
  const row = db.prepare(`SELECT id, company_id FROM ${table} WHERE id = ?`).get(id);
  if (!row) return { served: false, reason: "not-found" };
  return can(actor, permission, row.company_id)
    ? { served: true, row }
    : { served: false, reason: "forbidden" };
}

const LIST_SURFACES = [
  { table: "transport_jobs", permission: "jobs:read" },
  { table: "motorcycles", permission: "motorcycles:read" },
  { table: "status_events", permission: "status:read" },
  { table: "motorcycle_images", permission: "images:read" },
  { table: "yard_placements", permission: "motorcycles:read" },
  { table: "gallery_items", permission: "images:read" },
];

test("every company-scoped list returns only the customer's own company", () => {
  const db = seedTwoCompanies(migrated());
  for (const { table } of LIST_SURFACES) {
    const rows = scopedList(db, table, CUSTOMER_A);
    assert.ok(rows.length > 0, `${table}: the fixture must give customer A something to see`);
    for (const row of rows) {
      assert.equal(row.company_id, "company-a", `${table} leaked ${row.id} to customer A`);
    }
    const mirrored = scopedList(db, table, CUSTOMER_B);
    for (const row of mirrored) {
      assert.equal(row.company_id, "company-b", `${table} leaked ${row.id} to customer B`);
    }
    // The Owner is deliberately unscoped and must still see both.
    assert.equal(scopedList(db, table, OWNER).length, rows.length + mirrored.length, table);
  }
  db.close();
});

test("a customer opening another company's record by id is refused, not served", () => {
  const db = seedTwoCompanies(migrated());
  const cases = [
    { table: "transport_jobs", id: "job-b", permission: "jobs:read" },
    { table: "motorcycles", id: "mc-b", permission: "motorcycles:read" },
    { table: "motorcycle_images", id: "img-b", permission: "images:read" },
    { table: "status_events", id: "evt-b", permission: "status:read" },
    { table: "yard_placements", id: "yard-b", permission: "motorcycles:read" },
  ];
  for (const { table, id, permission } of cases) {
    const foreign = fetchAndAuthorize(db, table, id, CUSTOMER_A, permission);
    assert.equal(foreign.served, false, `${table}/${id} was served to the wrong company`);
    assert.equal(foreign.reason, "forbidden");

    const own = fetchAndAuthorize(db, table, id.replace(/-b$/, "-a"), CUSTOMER_A, permission);
    assert.equal(own.served, true, `${table}: customer A must still see its own record`);
  }
  db.close();
});

test("authorizing against the actor's own company instead of the row's is the leak this catches", () => {
  const db = seedTwoCompanies(migrated());
  const row = db.prepare("SELECT id, company_id FROM motorcycles WHERE id = 'mc-b'").get();
  assert.equal(row.company_id, "company-b");

  // What the code does: the row's company.
  assert.equal(can(CUSTOMER_A, "motorcycles:read", row.company_id), false);
  // What a plausible mistake does: the actor's own company. It always passes,
  // and it satisfies a static "calls can() with a company" check.
  assert.equal(can(CUSTOMER_A, "motorcycles:read", CUSTOMER_A.companyId), true);
  db.close();
});

test("private media and documents are bound to the owning company, not the requester", () => {
  const db = seedTwoCompanies(migrated());
  // /api/images/[id] fetches unscoped and authorizes on the stored company.
  assert.equal(fetchAndAuthorize(db, "motorcycle_images", "img-b", CUSTOMER_A, "images:read").served, false);
  assert.equal(fetchAndAuthorize(db, "motorcycle_images", "img-a", CUSTOMER_A, "images:read").served, true);
  assert.equal(fetchAndAuthorize(db, "motorcycle_images", "img-b", CUSTOMER_B, "images:read").served, true);
  // The Owner may read either.
  assert.equal(fetchAndAuthorize(db, "motorcycle_images", "img-a", OWNER, "images:read").served, true);
  assert.equal(fetchAndAuthorize(db, "motorcycle_images", "img-b", OWNER, "images:read").served, true);
  db.close();
});

test("a signed proof of delivery is readable only by the company it was delivered to", () => {
  const db = seedTwoCompanies(migrated());
  for (const suffix of ["a", "b"]) {
    // A POD is only accepted for an ARRIVED motorcycle with matching DELIVERY
    // evidence of the same company — trg_pod_records_validate_insert. The
    // fixture satisfies that rather than working around it.
    db.prepare("UPDATE motorcycles SET current_status = 'ARRIVED' WHERE id = ?").run(`mc-${suffix}`);
    db.prepare(
      "INSERT INTO motorcycle_images (id, request_key, motorcycle_id, company_id, category, storage_key, content_type, byte_size, checksum, uploaded_by) VALUES (?, ?, ?, ?, 'DELIVERY', ?, 'image/jpeg', 2048, ?, 'user-owner')",
    ).run(
      `img-delivery-${suffix}`,
      `req-img-delivery-${suffix}`,
      `mc-${suffix}`,
      `company-${suffix}`,
      `evidence/delivery-${suffix}.jpg`,
      suffix.repeat(64).slice(0, 63) + "1",
    );
    // Migration 0021 requires every new POD to declare signed evidence, so the
    // fixture creates a real signed record rather than a legacy unsigned one.
    db.prepare(
      "INSERT INTO proof_of_delivery_records (id, request_key, motorcycle_id, company_id, recipient_name, delivery_location, delivered_at, evidence_image_id, received_by, status, signature_required) VALUES (?, ?, ?, ?, 'ผู้รับ', 'หน้าร้าน', '2026-08-23T05:00:00.000Z', ?, 'user-owner', 'ACTIVE', 1)",
    ).run(`pod-${suffix}`, `req-pod-${suffix}`, `mc-${suffix}`, `company-${suffix}`, `img-delivery-${suffix}`);
    db.prepare(
      "INSERT INTO proof_of_delivery_signatures (id, pod_id, company_id, storage_key, content_type, width, height, byte_size, checksum, attested_by, attested_at) VALUES (?, ?, ?, ?, 'image/png', 600, 200, 4096, ?, 'user-owner', '2026-08-23T05:00:00.000Z')",
    ).run(
      `sig-${suffix}`,
      `pod-${suffix}`,
      `company-${suffix}`,
      `pod-signatures/${suffix}.png`,
      suffix.repeat(64).slice(0, 64),
    );
  }
  assert.equal(fetchAndAuthorize(db, "proof_of_delivery_records", "pod-b", CUSTOMER_A, "documents:read").served, false);
  assert.equal(fetchAndAuthorize(db, "proof_of_delivery_records", "pod-a", CUSTOMER_A, "documents:read").served, true);
  // The signature image is a separate private object with its own route.
  assert.equal(fetchAndAuthorize(db, "proof_of_delivery_signatures", "sig-b", CUSTOMER_A, "documents:read").served, false);
  assert.equal(fetchAndAuthorize(db, "proof_of_delivery_signatures", "sig-a", CUSTOMER_A, "documents:read").served, true);
  assert.equal(fetchAndAuthorize(db, "proof_of_delivery_signatures", "sig-b", CUSTOMER_B, "documents:read").served, true);
  db.close();
});

test("an operational report counts only the requesting company's rows", () => {
  const db = seedTwoCompanies(migrated());
  // Mirrors lib/operational-report.ts: customers get a company filter, internal
  // roles get none.
  const countFor = (actor, table) => {
    const companyId = isCustomerRole(actor.role) ? actor.companyId : null;
    return companyId
      ? db.prepare(`SELECT count(*) AS total FROM ${table} WHERE company_id = ?`).get(companyId).total
      : db.prepare(`SELECT count(*) AS total FROM ${table}`).get().total;
  };
  assert.equal(countFor(CUSTOMER_A, "motorcycles"), 1);
  assert.equal(countFor(CUSTOMER_B, "motorcycles"), 1);
  assert.equal(countFor(OWNER, "motorcycles"), 2);
  assert.equal(countFor(CUSTOMER_A, "transport_jobs"), 1);
  assert.equal(countFor(OWNER, "transport_jobs"), 2);
  db.close();
});

test("notifications are bound to one recipient, so a company-mate cannot read them either", () => {
  const db = seedTwoCompanies(migrated());
  db.prepare(
    "INSERT INTO users (id, external_auth_id, email, display_name, role, company_id, status) VALUES ('user-customer-a2', 'auth-a2', 'a2@example.test', 'ลูกค้า A2', 'CUSTOMER', 'company-a', 'ACTIVE')",
  ).run();
  const inbox = (userId) =>
    db.prepare("SELECT id FROM notifications WHERE recipient_user_id = ? ORDER BY id").all(userId).map((row) => row.id);
  assert.deepEqual(inbox("user-customer-a"), ["ntf-a"]);
  assert.deepEqual(inbox("user-customer-b"), ["ntf-b"]);
  assert.deepEqual(inbox("user-customer-a2"), [], "a company-mate is not a recipient");
  db.close();
});

test("a customer holds no write capability over any company, including its own", () => {
  const db = seedTwoCompanies(migrated());
  for (const permission of ["motorcycles:write", "jobs:write", "status:write", "images:write", "yard:write"]) {
    assert.equal(can(CUSTOMER_A, permission, "company-a"), false, `${permission} on own company`);
    assert.equal(can(CUSTOMER_A, permission, "company-b"), false, `${permission} on another company`);
  }
  // And the rows a write would target are still bound to their own company.
  const row = db.prepare("SELECT company_id FROM motorcycles WHERE id = 'mc-b'").get();
  assert.equal(row.company_id, "company-b");
  db.close();
});

// The behavioural cases above mirror the scoping the routes apply. If a route
// changes how it scopes, the mirror is stale and silently proves nothing, so
// the constructs those routes use are asserted to still be present.
const MIRRORED_ROUTES = [
  { file: "app/motorcycles/page.tsx", needle: "eq(motorcycles.companyId, actor.companyId)" },
  { file: "app/jobs/page.tsx", needle: "eq(transportJobs.companyId, actor.companyId)" },
  { file: "app/motorcycles/[id]/page.tsx", needle: 'can(actor, "motorcycles:read", record.companyId)' },
  { file: "app/motorcycles/[id]/documents/page.tsx", needle: 'can(actor, "documents:read", record.companyId)' },
  { file: "app/reports/page.tsx", needle: "isCustomerRole(actor.role) ? actor.companyId : undefined" },
  { file: "app/notifications/page.tsx", needle: "eq(notifications.recipientUserId, actor.userId)" },
];

test("the routes these cases mirror still scope the way the cases assume", () => {
  for (const { file, needle } of MIRRORED_ROUTES) {
    const source = readFileSync(`${APP_ROOT}${file}`, "utf8");
    assert.ok(
      source.includes(needle),
      `${file} no longer contains '${needle}', so the isolation case mirroring it is stale`,
    );
  }
});

test("the API surfaces these cases mirror still authorize on the stored company", () => {
  const apiRoot = fileURLToPath(new URL("../app/api/", import.meta.url));
  const cases = [
    { file: "images/[id]/route.ts", needle: 'can(actor, "images:read", metadata.companyId)' },
    { file: "pod-signatures/[id]/route.ts", needle: 'can(actor, "documents:read", metadata.companyId)' },
  ];
  for (const { file, needle } of cases) {
    const source = readFileSync(`${apiRoot}${file}`, "utf8");
    assert.ok(source.includes(needle), `${file} no longer authorizes on the stored company`);
    assert.ok(
      !source.includes('can(actor, "images:read", actor.companyId)') &&
        !source.includes('can(actor, "documents:read", actor.companyId)'),
      `${file} authorizes on the requester's own company, which always passes`,
    );
  }
});
