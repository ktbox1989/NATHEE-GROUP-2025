import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
function apply(db, path) { for (const statement of readFileSync(path, "utf8").split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement); }

test("audit pagination migration preserves history and uses its chronological index", () => {
  const db = new DatabaseSync(":memory:");
  const migrations = readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort();
  for (const name of migrations.filter((entry) => entry < "0019_")) apply(db, `${directory}/${name}`);
  db.exec("INSERT INTO audit_logs (id, action, entity_type, entity_id, created_at) VALUES ('audit-a', 'CREATE', 'job', 'job-a', '2026-08-21T00:00:00.000Z')");
  const migration = migrations.find((entry) => entry.startsWith("0019_"));
  assert.ok(migration, "migration 0019 is required");
  apply(db, `${directory}/${migration}`);
  assert.equal(db.prepare("SELECT count(*) total FROM audit_logs").get().total, 1);
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM audit_logs WHERE created_at < ? ORDER BY created_at DESC, id DESC LIMIT 51").all("2026-08-22T00:00:00.000Z").map((row) => String(row.detail)).join(" ");
  assert.match(plan, /idx_audit_logs_created_id/);
  db.close();
});
