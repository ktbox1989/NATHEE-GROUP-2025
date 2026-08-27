import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { createMotorcycleQrToken, parseMotorcycleQrToken } from "../lib/qr.ts";

const migrationDirectory = fileURLToPath(new URL("../drizzle/", import.meta.url));
const angles = ["LEFT", "RIGHT", "FRONT", "REAR"];

function applyMigrations(db) {
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(migrationDirectory).filter((entry) => entry.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${migrationDirectory}/${name}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
}

function seed(db) {
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name) VALUES ('company-a', 'CUS-A', 'NATHEE Acceptance Co', 'NATHEE Acceptance');
    INSERT INTO users (id, external_auth_id, email, display_name, role) VALUES ('owner-a', 'owner-pin:acceptance@example.test', 'acceptance@example.test', 'Acceptance Owner', 'OWNER');
    INSERT INTO user_role_assignments (user_id, role, assigned_by) VALUES ('owner-a', 'OWNER', 'owner-a');
    INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by)
      VALUES ('job-a', 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'JOB-ACCEPTANCE', 'company-a', 'Bangkok', 'Chonburi', 'OPEN', 'owner-a');
    INSERT INTO yard_zones (id, public_id, code, name, created_by)
      VALUES ('zone-a', 'yard_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Y-A', 'Acceptance Yard', 'owner-a');
    INSERT INTO yard_rows (id, yard_zone_id, code, name, created_by)
      VALUES ('row-a', 'zone-a', 'R1', 'Acceptance Row', 'owner-a');
    INSERT INTO yard_slots (id, yard_row_id, code, created_by)
      VALUES ('slot-a', 'row-a', '01', 'owner-a');
  `);
}

test("real isolated D1 + R2 intake lifecycle persists, scans and cleans up through canonical history", async () => {
  const temp = mkdtempSync(join(tmpdir(), "nathee-slice1-"));
  const databasePath = join(temp, "acceptance.sqlite");
  const db = new DatabaseSync(databasePath);
  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    r2Buckets: ["FILES"],
    script: `
      export default { async fetch(request, env) {
        const url = new URL(request.url);
        const key = url.searchParams.get('key');
        if (!key) return new Response('bad key', { status: 400 });
        if (request.method === 'DELETE') { await env.FILES.delete(key); return new Response(null, { status: 204 }); }
        const bytes = await request.arrayBuffer();
        await env.FILES.put(key, bytes, { httpMetadata: { contentType: 'image/png' }, customMetadata: { private: 'true' } });
        const stored = await env.FILES.head(key);
        return Response.json({ key: stored.key, size: stored.size, contentType: stored.httpMetadata?.contentType });
      } };
    `,
  });

  try {
    applyMigrations(db);
    seed(db);

    const motorcycleId = "mc-acceptance";
    const publicId = "mc_0123456789abcdef0123456789abcdef";
    db.exec("BEGIN");
    try {
      db.prepare(`INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, make, model, color, vin, vehicle_condition, current_status)
        VALUES (?, ?, 'company-a', 'job-a', 1, 'Honda', 'Wave 125i', 'Red', 'VIN-ACCEPTANCE', 'NEW', 'PENDING_RECEIPT')`).run(motorcycleId, publicId);
      db.prepare(`INSERT INTO status_events (id, motorcycle_id, company_id, previous_status, new_status, note, created_by)
        VALUES ('status-create', ?, 'company-a', NULL, 'PENDING_RECEIPT', 'acceptance intake', 'owner-a')`).run(motorcycleId);
      db.prepare(`INSERT INTO audit_logs (id, actor_user_id, company_id, action, entity_type, entity_id, after_json)
        VALUES ('audit-create', 'owner-a', 'company-a', 'CREATE', 'motorcycle', ?, '{"source":"acceptance"}'),
               ('audit-qr', 'owner-a', 'company-a', 'QR_ASSIGN', 'motorcycle', ?, ?)`).run(motorcycleId, motorcycleId, JSON.stringify({ publicId }));
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    assert.equal(parseMotorcycleQrToken(createMotorcycleQrToken(publicId)), publicId);

    const beforeEdit = db.prepare("SELECT updated_at FROM motorcycles WHERE id=?").get(motorcycleId);
    db.prepare("UPDATE motorcycles SET color='Blue', notes='backend-confirmed', updated_at='2026-08-27 12:00:01' WHERE id=? AND updated_at=? AND current_status='PENDING_RECEIPT'").run(motorcycleId, beforeEdit.updated_at);
    db.prepare(`INSERT INTO audit_logs (id, actor_user_id, company_id, action, entity_type, entity_id, before_json, after_json)
      VALUES ('audit-edit', 'owner-a', 'company-a', 'UPDATE', 'motorcycle', ?, '{"color":"Red"}', '{"color":"Blue"}')`).run(motorcycleId);
    assert.equal(db.prepare("SELECT color FROM motorcycles WHERE id=?").get(motorcycleId).color, "Blue");

    const staleUpdate = db.prepare("UPDATE motorcycles SET color='Green', updated_at='2026-08-27 12:00:01' WHERE id=? AND updated_at=? AND current_status='PENDING_RECEIPT'").run(motorcycleId, beforeEdit.updated_at);
    assert.equal(staleUpdate.changes, 0);
    const staleAudit = db.prepare(`INSERT INTO audit_logs (id, actor_user_id, company_id, action, entity_type, entity_id, before_json, after_json)
      SELECT 'audit-stale-edit', 'owner-a', company_id, 'UPDATE', 'motorcycle', id, '{"color":"Red"}', '{"color":"Green"}'
      FROM motorcycles WHERE id=? AND updated_at='2026-08-27 12:00:01' AND changes()=1`).run(motorcycleId);
    assert.equal(staleAudit.changes, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM audit_logs WHERE id='audit-stale-edit'").get().n, 0);

    const storedKeys = [];
    for (const [index, angle] of angles.entries()) {
      const key = `companies/company-a/motorcycles/${motorcycleId}/acceptance-${angle.toLowerCase()}.png`;
      const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, index]);
      const response = await runtime.dispatchFetch(`http://local.test/?key=${encodeURIComponent(key)}`, { method: "PUT", body: bytes });
      assert.equal(response.status, 200);
      const stored = await response.json();
      assert.deepEqual(stored, { key, size: bytes.byteLength, contentType: "image/png" });
      storedKeys.push(key);
      db.prepare(`INSERT INTO motorcycle_images
        (id, request_key, motorcycle_id, company_id, storage_key, category, content_type, byte_size, checksum, uploaded_by)
        VALUES (?, ?, ?, 'company-a', ?, ?, 'image/png', ?, ?, 'owner-a')`)
        .run(`image-${angle.toLowerCase()}`, `motorcycle-image-10000000-0000-4000-8000-00000000010${index}`, motorcycleId, key, angle, bytes.byteLength, String(index + 1).repeat(64));
      db.prepare(`INSERT INTO audit_logs (id, actor_user_id, company_id, action, entity_type, entity_id, after_json)
        VALUES (?, 'owner-a', 'company-a', 'UPLOAD_IMAGE', 'motorcycle_image', ?, ?)`)
        .run(`audit-image-${index}`, `image-${angle.toLowerCase()}`, JSON.stringify({ motorcycleId, angle }));
    }

    db.prepare(`INSERT INTO motorcycle_inspections
      (id, request_key, motorcycle_id, company_id, type, result, fuel_level, notes,
       left_image_id, right_image_id, front_image_id, rear_image_id, inspected_by, inspected_at)
      VALUES ('inspection-a', '10000000-0000-4000-8000-000000000200', ?, 'company-a', 'RECEIPT', 'PASS', 'HALF', 'acceptance pass',
       'image-left', 'image-right', 'image-front', 'image-rear', 'owner-a', '2026-08-27T12:10:00.000Z')`).run(motorcycleId);
    db.prepare(`INSERT INTO audit_logs (id, actor_user_id, company_id, action, entity_type, entity_id, after_json)
      VALUES ('audit-inspection', 'owner-a', 'company-a', 'CREATE', 'motorcycle_inspection', 'inspection-a', '{"angles":4}')`).run();
    db.prepare(`INSERT INTO status_events (id, motorcycle_id, company_id, previous_status, new_status, note, created_by)
      VALUES ('status-received', ?, 'company-a', 'PENDING_RECEIPT', 'RECEIVED', 'four-angle receipt passed', 'owner-a')`).run(motorcycleId);
    db.prepare("UPDATE motorcycles SET current_status='RECEIVED' WHERE id=? AND current_status='PENDING_RECEIPT'").run(motorcycleId);

    db.prepare(`INSERT INTO yard_placements
      (id, request_key, motorcycle_id, company_id, yard_zone_id, yard_row_id, yard_slot_id, entered_at, placed_by, note)
      VALUES ('placement-a', '10000000-0000-4000-8000-000000000300', ?, 'company-a', 'zone-a', 'row-a', 'slot-a', '2026-08-27T12:20:00.000Z', 'owner-a', 'acceptance')`).run(motorcycleId);
    db.prepare(`INSERT INTO audit_logs (id, actor_user_id, company_id, action, entity_type, entity_id, after_json)
      VALUES ('audit-yard', 'owner-a', 'company-a', 'YARD_ENTRY', 'motorcycle', ?, '{"zone":"Y-A","row":"R1","slot":"01"}')`).run(motorcycleId);

    const scanned = db.prepare(`SELECT m.public_id, m.current_status, i.result, z.code zone_code, r.code row_code, s.code slot_code
      FROM motorcycles m
      JOIN motorcycle_inspections i ON i.motorcycle_id=m.id AND i.type='RECEIPT'
      JOIN yard_placements p ON p.motorcycle_id=m.id AND p.exited_at IS NULL
      JOIN yard_zones z ON z.id=p.yard_zone_id JOIN yard_rows r ON r.id=p.yard_row_id JOIN yard_slots s ON s.id=p.yard_slot_id
      WHERE m.public_id=?`).get(parseMotorcycleQrToken(createMotorcycleQrToken(publicId)));
    assert.deepEqual({ ...scanned }, { public_id: publicId, current_status: "RECEIVED", result: "PASS", zone_code: "Y-A", row_code: "R1", slot_code: "01" });
    db.prepare(`INSERT INTO audit_logs (id, actor_user_id, company_id, action, entity_type, entity_id, after_json)
      VALUES ('audit-scan', 'owner-a', 'company-a', 'QR_RESOLVE', 'motorcycle', ?, '{"acceptance":true}')`).run(motorcycleId);

    const reopened = new DatabaseSync(databasePath, { readOnly: true });
    const persisted = reopened.prepare("SELECT m.color, m.current_status, p.yard_slot_id FROM motorcycles m JOIN yard_placements p ON p.motorcycle_id=m.id AND p.exited_at IS NULL WHERE m.id=?").get(motorcycleId);
    assert.deepEqual({ ...persisted }, { color: "Blue", current_status: "RECEIVED", yard_slot_id: "slot-a" });
    reopened.close();

    db.exec(`INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, vin, current_status)
      VALUES ('mc-conflict', 'mc_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'company-a', 'job-a', 2, 'VIN-CONFLICT', 'RECEIVED')`);
    assert.throws(() => db.exec(`INSERT INTO yard_placements
      (id, request_key, motorcycle_id, company_id, yard_zone_id, yard_row_id, yard_slot_id, entered_at, placed_by)
      VALUES ('placement-conflict', '10000000-0000-4000-8000-000000000301', 'mc-conflict', 'company-a', 'zone-a', 'row-a', 'slot-a', '2026-08-27T12:21:00.000Z', 'owner-a')`), /UNIQUE|constraint/i);

    db.prepare("UPDATE yard_placements SET exited_at='2026-08-27T12:30:00.000Z' WHERE id='placement-a' AND exited_at IS NULL").run();
    db.prepare(`INSERT INTO audit_logs (id, actor_user_id, company_id, action, entity_type, entity_id, after_json)
      VALUES ('audit-yard-exit', 'owner-a', 'company-a', 'YARD_EXIT', 'motorcycle', ?, '{"yard":null}')`).run(motorcycleId);
    db.prepare(`INSERT INTO status_events (id, motorcycle_id, company_id, previous_status, new_status, note, created_by)
      VALUES ('status-cancelled', ?, 'company-a', 'RECEIVED', 'CANCELLED', 'acceptance cleanup', 'owner-a')`).run(motorcycleId);
    db.prepare("UPDATE motorcycles SET current_status='CANCELLED' WHERE id=? AND current_status='RECEIVED'").run(motorcycleId);
    assert.equal(db.prepare("SELECT count(*) n FROM yard_placements WHERE motorcycle_id=? AND exited_at IS NULL").get(motorcycleId).n, 0);
    assert.equal(db.prepare("SELECT current_status FROM motorcycles WHERE id=?").get(motorcycleId).current_status, "CANCELLED");
    assert.ok(db.prepare("SELECT count(*) n FROM audit_logs WHERE entity_id=?").get(motorcycleId).n >= 6);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);

    for (const key of storedKeys) await runtime.dispatchFetch(`http://local.test/?key=${encodeURIComponent(key)}`, { method: "DELETE" });
  } finally {
    db.close();
    await runtime.dispose();
    rmSync(temp, { recursive: true, force: true });
  }
});
