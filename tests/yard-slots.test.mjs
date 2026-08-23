import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Zone -> Row -> Slot, where a slot is a real parking position. The rules are
// proven against a migrated database because the point of the model is that the
// yard cannot be wrong, not that the application usually gets it right.

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));

function migrated() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${directory}/${name}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name)
    VALUES ('company-a', 'CUS-A', 'บริษัท เอ จำกัด', 'บริษัท เอ'),
           ('company-b', 'CUS-B', 'บริษัท บี จำกัด', 'บริษัท บี');
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by)
    VALUES ('job-a', 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'JOB-001', 'company-a', 'A', 'B', 'OPEN', 'owner-a');
    INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, current_status)
    VALUES ('mc-1', 'mc-1', 'company-a', 'job-a', 1, 'IN_YARD'),
           ('mc-2', 'mc-2', 'company-a', 'job-a', 2, 'IN_YARD'),
           ('mc-3', 'mc-3', 'company-a', 'job-a', 3, 'IN_YARD');
    -- A mapped zone (slots) and a legacy zone (manual capacity), side by side.
    INSERT INTO yard_zones (id, public_id, code, name, created_by)
    VALUES ('zone-mapped', 'yard_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'A-01', 'Zone A', 'owner-a');
    INSERT INTO yard_zones (id, public_id, code, name, capacity, created_by)
    VALUES ('zone-legacy', 'yard_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'B-01', 'Zone B', 2, 'owner-a');
    INSERT INTO yard_rows (id, yard_zone_id, code, created_by)
    VALUES ('row-1', 'zone-mapped', 'R1', 'owner-a'),
           ('row-2', 'zone-mapped', 'R2', 'owner-a');
    INSERT INTO yard_slots (id, yard_row_id, code, created_by)
    VALUES ('slot-1', 'row-1', '01', 'owner-a'),
           ('slot-2', 'row-1', '02', 'owner-a'),
           ('slot-3', 'row-2', '01', 'owner-a');
  `);
  return db;
}

const placeInSlot = (db, id, motorcycleId, slotId, options = {}) =>
  db.exec(
    `INSERT INTO yard_placements
       (id, request_key, motorcycle_id, company_id, yard_zone_id, yard_row_id, yard_slot_id, entered_at, placed_by)
     SELECT '${id}', 'key-${id}', '${motorcycleId}', '${options.companyId ?? "company-a"}',
            r.yard_zone_id, r.id, s.id, '${options.enteredAt ?? "2026-08-20T10:00:00.000Z"}', 'owner-a'
     FROM yard_slots s JOIN yard_rows r ON r.id = s.yard_row_id
     WHERE s.id = '${slotId}'`,
  );

test("a zone holds rows and a row holds slots", () => {
  const db = migrated();
  assert.equal(db.prepare("SELECT count(*) AS n FROM yard_rows WHERE yard_zone_id = 'zone-mapped'").get().n, 2);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM yard_slots s JOIN yard_rows r ON r.id = s.yard_row_id WHERE r.yard_zone_id = 'zone-mapped'").get().n,
    3,
  );
  db.close();
});

test("a slot code is stable and unique within its row, and reusable across rows", () => {
  const db = migrated();
  assert.throws(
    () => db.exec("INSERT INTO yard_slots (id, yard_row_id, code, created_by) VALUES ('dup', 'row-1', '01', 'owner-a')"),
    /UNIQUE|constraint/i,
  );
  // Row 2 already has its own '01'; the same code in a different row is a
  // different physical position.
  assert.equal(db.prepare("SELECT count(*) AS n FROM yard_slots WHERE code = '01'").get().n, 2);
  db.close();
});

test("a row code is unique within its zone", () => {
  const db = migrated();
  assert.throws(
    () => db.exec("INSERT INTO yard_rows (id, yard_zone_id, code, created_by) VALUES ('dup', 'zone-mapped', 'R1', 'owner-a')"),
    /UNIQUE|constraint/i,
  );
  db.close();
});

test("one slot holds one motorcycle", () => {
  const db = migrated();
  placeInSlot(db, "p1", "mc-1", "slot-1");
  assert.throws(() => placeInSlot(db, "p2", "mc-2", "slot-1"), /UNIQUE|constraint/i);
  assert.equal(db.prepare("SELECT count(*) AS n FROM yard_placements WHERE yard_slot_id = 'slot-1' AND exited_at IS NULL").get().n, 1);
  db.close();
});

test("a motorcycle still holds only one placement, whichever slot", () => {
  const db = migrated();
  placeInSlot(db, "p1", "mc-1", "slot-1");
  assert.throws(() => placeInSlot(db, "p2", "mc-1", "slot-2"), /UNIQUE|constraint/i);
  db.close();
});

test("a freed slot can be filled again", () => {
  const db = migrated();
  placeInSlot(db, "p1", "mc-1", "slot-1");
  db.exec("UPDATE yard_placements SET exited_at = '2026-08-21T10:00:00.000Z' WHERE id = 'p1'");
  placeInSlot(db, "p2", "mc-2", "slot-1");
  assert.equal(db.prepare("SELECT motorcycle_id FROM yard_placements WHERE yard_slot_id = 'slot-1' AND exited_at IS NULL").get().motorcycle_id, "mc-2");
  db.close();
});

test("a blocked or retired slot cannot take a motorcycle", () => {
  for (const status of ["BLOCKED", "RETIRED"]) {
    const db = migrated();
    db.exec(`UPDATE yard_slots SET status = '${status}' WHERE id = 'slot-1'`);
    assert.throws(() => placeInSlot(db, "p1", "mc-1", "slot-1"), /slot cannot take a motorcycle/, status);
    db.close();
  }
});

test("a blocked row blocks every slot in it", () => {
  const db = migrated();
  db.exec("UPDATE yard_rows SET status = 'BLOCKED' WHERE id = 'row-1'");
  assert.throws(() => placeInSlot(db, "p1", "mc-1", "slot-1"), /slot cannot take a motorcycle/);
  placeInSlot(db, "p2", "mc-2", "slot-3");
  assert.equal(db.prepare("SELECT count(*) AS n FROM yard_placements WHERE exited_at IS NULL").get().n, 1);
  db.close();
});

// The zone, row and slot on a placement have to describe one physical place.
test("a slot cannot be recorded under the wrong zone or row", () => {
  const db = migrated();
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO yard_placements (id, request_key, motorcycle_id, company_id, yard_zone_id, yard_row_id, yard_slot_id, entered_at, placed_by)
         VALUES ('p1', 'k1', 'mc-1', 'company-a', 'zone-legacy', 'row-1', 'slot-1', '2026-08-20T10:00:00.000Z', 'owner-a')`,
      ),
    /same place/,
  );
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO yard_placements (id, request_key, motorcycle_id, company_id, yard_zone_id, yard_row_id, yard_slot_id, entered_at, placed_by)
         VALUES ('p2', 'k2', 'mc-1', 'company-a', 'zone-mapped', 'row-2', 'slot-1', '2026-08-20T10:00:00.000Z', 'owner-a')`,
      ),
    /same place/,
  );
  db.close();
});

test("a row cannot be recorded under a zone it does not belong to", () => {
  const db = migrated();
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO yard_placements (id, request_key, motorcycle_id, company_id, yard_zone_id, yard_row_id, entered_at, placed_by)
         VALUES ('p1', 'k1', 'mc-1', 'company-a', 'zone-legacy', 'row-1', '2026-08-20T10:00:00.000Z', 'owner-a')`,
      ),
    /same place/,
  );
  db.close();
});

// Capacity is the number of slots, or the manual number, never both.
test("a mapped zone refuses a hand-written capacity", () => {
  const db = migrated();
  assert.throws(() => db.exec("UPDATE yard_zones SET capacity = 99 WHERE id = 'zone-mapped'"), /cannot be set by hand/);
  db.close();
});

test("a zone with a hand-written capacity refuses slots until it is cleared", () => {
  const db = migrated();
  db.exec("INSERT INTO yard_rows (id, yard_zone_id, code, created_by) VALUES ('row-legacy', 'zone-legacy', 'R1', 'owner-a')");
  assert.throws(
    () => db.exec("INSERT INTO yard_slots (id, yard_row_id, code, created_by) VALUES ('s', 'row-legacy', '01', 'owner-a')"),
    /clear the manual capacity/,
  );
  db.exec("UPDATE yard_zones SET capacity = NULL WHERE id = 'zone-legacy'");
  db.exec("INSERT INTO yard_slots (id, yard_row_id, code, created_by) VALUES ('s', 'row-legacy', '01', 'owner-a')");
  db.close();
});

test("a mapped zone will not take a motorcycle without an exact slot", () => {
  const db = migrated();
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO yard_placements (id, request_key, motorcycle_id, company_id, yard_zone_id, entered_at, placed_by)
         VALUES ('p1', 'k1', 'mc-1', 'company-a', 'zone-mapped', '2026-08-20T10:00:00.000Z', 'owner-a')`,
      ),
    /needs an exact slot/,
  );
  db.close();
});

test("the slot count is the capacity, so a full zone refuses the next motorcycle", () => {
  const db = migrated();
  placeInSlot(db, "p1", "mc-1", "slot-1");
  placeInSlot(db, "p2", "mc-2", "slot-2");
  placeInSlot(db, "p3", "mc-3", "slot-3");
  db.exec(`
    INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, current_status)
    VALUES ('mc-4', 'mc-4', 'company-a', 'job-a', 4, 'IN_YARD');
  `);
  // Every slot is taken, so there is nowhere left to put it.
  for (const slot of ["slot-1", "slot-2", "slot-3"]) {
    assert.throws(() => placeInSlot(db, `p-${slot}`, "mc-4", slot), /UNIQUE|constraint/i, slot);
  }
  db.close();
});

// Existing yards keep working exactly as before.
test("an unmapped zone still places by zone alone, on its manual capacity", () => {
  const db = migrated();
  const placeInZone = (id, motorcycleId) =>
    db.exec(
      `INSERT INTO yard_placements (id, request_key, motorcycle_id, company_id, yard_zone_id, entered_at, placed_by)
       VALUES ('${id}', 'k-${id}', '${motorcycleId}', 'company-a', 'zone-legacy', '2026-08-20T10:00:00.000Z', 'owner-a')`,
    );
  placeInZone("p1", "mc-1");
  placeInZone("p2", "mc-2");
  assert.throws(() => placeInZone("p3", "mc-3"), /already at capacity/);
  db.close();
});

test("a placement made before the zone was mapped is preserved and still readable", () => {
  const db = migrated();
  db.exec(`
    INSERT INTO yard_zones (id, public_id, code, name, created_by)
    VALUES ('zone-later', 'yard_cccccccccccccccccccccccccccccccc', 'C-01', 'Zone C', 'owner-a');
    INSERT INTO yard_placements (id, request_key, motorcycle_id, company_id, yard_zone_id, entered_at, placed_by)
    VALUES ('legacy-1', 'k-legacy', 'mc-1', 'company-a', 'zone-later', '2026-07-01T10:00:00.000Z', 'owner-a');
    INSERT INTO yard_rows (id, yard_zone_id, code, created_by) VALUES ('row-later', 'zone-later', 'R1', 'owner-a');
    INSERT INTO yard_slots (id, yard_row_id, code, created_by) VALUES ('slot-later', 'row-later', '01', 'owner-a');
  `);
  const row = db.prepare("SELECT yard_zone_id, yard_slot_id FROM yard_placements WHERE id = 'legacy-1'").get();
  assert.equal(row.yard_zone_id, "zone-later");
  assert.equal(row.yard_slot_id, null, "an older placement keeps its zone-only record");
  db.close();
});

// Migration 0027 must survive the expansion.
test("the company invariant still holds for a slot placement", () => {
  const db = migrated();
  assert.throws(() => placeInSlot(db, "p1", "mc-1", "slot-1", { companyId: "company-b" }), /company that owns/);
  db.close();
});

test("where a motorcycle was cannot be rewritten, including its row and slot", () => {
  const db = migrated();
  placeInSlot(db, "p1", "mc-1", "slot-1");
  for (const change of ["yard_slot_id = 'slot-2'", "yard_row_id = 'row-2'", "yard_zone_id = 'zone-legacy'"]) {
    assert.throws(() => db.exec(`UPDATE yard_placements SET ${change} WHERE id = 'p1'`), /only its exit may be set/, change);
  }
  db.exec("UPDATE yard_placements SET exited_at = '2026-08-22T10:00:00.000Z' WHERE id = 'p1'");
  db.close();
});

// A move is two rows: the one it left, and the one it went to.
test("movement history records the exact place it came from and went to", () => {
  const db = migrated();
  placeInSlot(db, "p1", "mc-1", "slot-1");
  db.exec("UPDATE yard_placements SET exited_at = '2026-08-21T09:00:00.000Z' WHERE id = 'p1'");
  placeInSlot(db, "p2", "mc-1", "slot-3", { enteredAt: "2026-08-21T09:00:00.000Z" });

  const history = db
    .prepare(
      `SELECT z.code AS zone, r.code AS row_code, s.code AS slot, p.entered_at, p.exited_at
       FROM yard_placements p
       JOIN yard_zones z ON z.id = p.yard_zone_id
       LEFT JOIN yard_rows r ON r.id = p.yard_row_id
       LEFT JOIN yard_slots s ON s.id = p.yard_slot_id
       WHERE p.motorcycle_id = 'mc-1'
       ORDER BY p.entered_at`,
    )
    .all();
  assert.equal(history.length, 2);
  assert.deepEqual(
    history.map((entry) => `${entry.zone}/${entry.row_code}/${entry.slot}`),
    ["A-01/R1/01", "A-01/R2/01"],
  );
  assert.equal(history[0].exited_at, "2026-08-21T09:00:00.000Z", "the place it left is closed at the moment it left");
  assert.equal(history[1].exited_at, null, "the place it went to is still open");
  db.close();
});

test("finding what is in a slot, and where a motorcycle is, stay index-backed", () => {
  const db = migrated();
  placeInSlot(db, "p1", "mc-1", "slot-1");
  const plan = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((row) => row.detail).join(" ");
  assert.match(
    plan("SELECT motorcycle_id FROM yard_placements WHERE yard_slot_id = ? AND exited_at IS NULL"),
    /uq_yard_placements_slot_active|idx_yard_placements_slot_entered/,
  );
  assert.match(
    plan("SELECT yard_slot_id FROM yard_placements WHERE motorcycle_id = ? AND exited_at IS NULL"),
    /uq_yard_placements_motorcycle_active|idx_yard_placements_motorcycle_entered/,
  );
  assert.match(plan("SELECT id FROM yard_slots WHERE yard_row_id = ? ORDER BY sort_order, code"), /idx_yard_slots_row_order/);
  db.close();
});
