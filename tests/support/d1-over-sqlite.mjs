import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A D1 client backed by node:sqlite, so the real Drizzle query builders can be
// executed against a real database in a test.
//
// The alternative is to assert against SQL written a second time in the test,
// which proves that two hand-written queries agree and nothing about the one
// that runs in Production. Here the query under test is the query that runs:
// the same builder, the same schema, the same constraints and the same
// triggers, applied by the same migration files.
//
// This implements only the surface `drizzle-orm/d1` uses - prepare, bind, run,
// all, raw and batch - and deliberately no more. It is a test harness, not a
// second D1.

const migrationsDirectory = fileURLToPath(new URL("../../drizzle/", import.meta.url));

function toResults(statement, params) {
  // node:sqlite refuses `undefined` and has no boolean binding; D1 accepts both
  // and stores booleans as integers, so the same normalisation is applied here.
  return statement.all(...params.map(normalize));
}

function normalize(value) {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

class PreparedStatement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new PreparedStatement(this.database, this.sql, params);
  }

  run() {
    const statement = this.database.prepare(this.sql);
    const info = statement.run(...this.params.map(normalize));
    return {
      success: true,
      results: [],
      meta: { changes: Number(info.changes ?? 0), last_row_id: Number(info.lastInsertRowid ?? 0) },
    };
  }

  all() {
    const statement = this.database.prepare(this.sql);
    return { success: true, results: toResults(statement, this.params), meta: {} };
  }

  raw() {
    const statement = this.database.prepare(this.sql);
    statement.setReadBigInts(false);
    const rows = toResults(statement, this.params);
    return rows.map((row) => Object.values(row));
  }

  first(column) {
    const [row] = this.all().results;
    if (!row) return null;
    return column === undefined ? row : (row[column] ?? null);
  }
}

/**
 * D1 runs a batch as one transaction and stops at the first failure, leaving
 * nothing behind. Reproduced here, because half-applied batches are exactly
 * what the publish and rename paths must never produce.
 */
class D1OverSqlite {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new PreparedStatement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.all());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(sql) {
    this.database.exec(sql);
    return { count: 0, duration: 0 };
  }
}

/** A database with every migration applied, in order, exactly as D1 will. */
export function migratedSqlite() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(migrationsDirectory).filter((entry) => entry.endsWith(".sql")).sort()) {
    const sql = readFileSync(`${migrationsDirectory}${name}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) database.exec(statement);
    }
  }
  return database;
}

export function d1Over(database) {
  return new D1OverSqlite(database);
}
