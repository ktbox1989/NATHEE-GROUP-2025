import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));

function apply(db, path) {
  for (const statement of readFileSync(path, "utf8").split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
}

test("Print Center identifier searches are bounded by dedicated indexes", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort()) apply(db, `${directory}/${name}`);

  const contracts = [
    ["transport_jobs", "job_number", "uq_transport_jobs_job_number", "JOB-2026-*", ""],
    ["motorcycles", "registration", "idx_motorcycles_registration", "กข*", ""],
    ["motorcycles", "vin", "uq_motorcycles_vin", "VIN*", "AND vin IS NOT NULL AND vin <> ''"],
    ["motorcycles", "engine_number", "uq_motorcycles_engine_number", "ENG*", "AND engine_number IS NOT NULL AND engine_number <> ''"],
    ["yard_zones", "code", "uq_yard_zones_code", "A-*", ""],
    ["trucks", "code", "uq_trucks_code", "NG-*", ""],
    ["trips", "trip_number", "uq_trips_trip_number", "TRIP-2026-*", ""],
    ["shipping_containers", "container_number", "uq_shipping_containers_number", "CSQU*", ""],
  ];

  for (const [table, column, expectedIndex, pattern, predicate] of contracts) {
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM ${table} WHERE ${column} GLOB ? ${predicate} ORDER BY ${column} LIMIT 51`).all(pattern).map((row) => String(row.detail)).join(" ");
    assert.match(plan, new RegExp(expectedIndex), `${table}.${column} must use ${expectedIndex}`);
  }
  db.close();
});
