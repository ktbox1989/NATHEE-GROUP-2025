/**
 * Which migrations a deployed database has actually had applied.
 *
 * This repository has no migration runner and no `__drizzle_migrations` table,
 * so `drizzle/meta/_journal.json` records which migrations *exist*, not which
 * have been applied to Production. Those are different questions, and the
 * runbook used to blur them: "read the ledger and apply what is missing" cannot
 * be done from the ledger alone.
 *
 * What can answer it is the deployed schema itself. Each migration creates a
 * known set of tables, indexes and triggers, so the objects present in the live
 * database say how far the chain got. This computes that, and is deliberately
 * strict about the one state that must never be guessed past: a migration whose
 * objects are only partly present, which means an apply stopped half-way.
 */

export type SchemaObject = { type: "table" | "index" | "trigger"; name: string };

export type MigrationSource = { tag: string; sql: string };

export type MigrationStep = {
  tag: string;
  /** Everything expected to exist once this migration and all before it ran. */
  cumulative: ReadonlySet<string>;
  /** What this migration adds on its own, for reporting a partial apply. */
  introduces: ReadonlySet<string>;
};

export type MigrationPlan = {
  /** Index of the last migration proven fully applied, -1 when none is. */
  appliedThrough: number;
  appliedTags: readonly string[];
  remainingTags: readonly string[];
  /**
   * Set when a migration is partly present. Applying anything on top of this is
   * unsafe; the backup is the way out.
   */
  partial: { tag: string; present: readonly string[]; missing: readonly string[] } | null;
  /** Objects in the database that no migration accounts for. */
  unexpected: readonly string[];
  /**
   * Migrations the deployed schema cannot distinguish. A migration that rebuilds
   * a table leaves the schema exactly as it found it, so whether it ran cannot
   * be read from the catalogue. Re-running one drops a live table, so this is
   * reported rather than guessed.
   */
  ambiguous: readonly string[];
};

const key = (object: SchemaObject) => `${object.type}:${object.name}`;

/**
 * SQLite names some objects itself, and a table rebuild leaves a transient
 * `__new_` name behind. Neither belongs to a migration.
 */
function isTracked(name: string): boolean {
  return !name.startsWith("sqlite_") && !name.startsWith("__new_") && name !== "_cf_KV";
}

/** The object set each migration leaves behind, applied in order. */
export function migrationSteps(sources: readonly MigrationSource[]): MigrationStep[] {
  const steps: MigrationStep[] = [];
  const running = new Set<string>();

  for (const { tag, sql } of sources) {
    const before = new Set(running);

    // Statement by statement, in order. Applying every CREATE and then every
    // DROP loses a migration that supersedes a trigger by dropping and
    // recreating it under the same name, and reports an object as absent while
    // the database still has it.
    for (const statement of sql.split("--> statement-breakpoint")) {
      for (const [, name] of statement.matchAll(/CREATE TABLE `([a-z_0-9]+)`/g)) {
        if (isTracked(name)) running.add(`table:${name}`);
      }
      for (const [, name] of statement.matchAll(/CREATE TRIGGER `([a-z_0-9]+)`/g)) {
        if (isTracked(name)) running.add(`trigger:${name}`);
      }
      for (const [, name] of statement.matchAll(/CREATE (?:UNIQUE )?INDEX `([a-z_0-9]+)`/g)) {
        if (isTracked(name)) running.add(`index:${name}`);
      }
      for (const [, name] of statement.matchAll(/DROP TABLE (?:IF EXISTS )?`([a-z_0-9]+)`/g)) running.delete(`table:${name}`);
      // A table rebuild builds `__new_x`, drops `x`, then renames. Without the
      // rename the table is recorded as dropped and never restored, so every
      // rebuilt table would be reported as an object no migration creates.
      for (const [, from, to] of statement.matchAll(/ALTER TABLE `([a-z_0-9]+)` RENAME TO `([a-z_0-9]+)`/g)) {
        running.delete(`table:${from}`);
        if (isTracked(to)) running.add(`table:${to}`);
      }
      for (const [, name] of statement.matchAll(/DROP TRIGGER (?:IF EXISTS )?`([a-z_0-9]+)`/g)) running.delete(`trigger:${name}`);
      for (const [, name] of statement.matchAll(/DROP INDEX (?:IF EXISTS )?`([a-z_0-9]+)`/g)) running.delete(`index:${name}`);
    }

    const introduces = new Set([...running].filter((entry) => !before.has(entry)));
    steps.push({ tag, cumulative: new Set(running), introduces });
  }

  return steps;
}

export function planMigrations(
  steps: readonly MigrationStep[],
  deployed: readonly SchemaObject[],
): MigrationPlan {
  const present = new Set(deployed.filter((object) => isTracked(object.name)).map(key));

  // The state after each number of migrations, starting with none applied.
  const states: ReadonlySet<string>[] = [new Set<string>(), ...steps.map((step) => step.cumulative)];

  // Some objects are transient: a migration creates one and a later migration
  // drops it. Comparing a database against a state it should *contain* would
  // therefore stop at the first such object, so the comparison is exact
  // equality against each state instead. Anything no migration ever creates is
  // taken out of that comparison and reported separately, or one stray table
  // would make every state look wrong.
  const everKnown = new Set(states.flatMap((state) => [...state]));
  const unexpected = [...present].filter((entry) => !everKnown.has(entry)).sort();
  const comparable = new Set([...present].filter((entry) => everKnown.has(entry)));

  const scored = states.map((state, index) => {
    const missing = [...state].filter((entry) => !comparable.has(entry));
    const extra = [...comparable].filter((entry) => !state.has(entry));
    return { index, missing, extra, score: missing.length + extra.length };
  });
  const bestScore = Math.min(...scored.map((entry) => entry.score));
  const fits = scored.filter((entry) => entry.score === bestScore);

  // Ties are broken in opposite directions depending on what they mean.
  //
  // An exact tie is two clean states the catalogue cannot tell apart, because a
  // migration rebuilt a table and ended where it started. Take the furthest:
  // skipping a migration that changes no object is harmless, while re-running
  // one drops and rebuilds a table holding live rows.
  //
  // An inexact tie is a half-applied migration, where counting it as nearly
  // complete would be the optimistic reading of a broken state. Take the
  // nearest, so the interrupted migration is not treated as applied.
  const best = bestScore === 0 ? fits[fits.length - 1] : fits[0];
  const bestIndex = best.index;
  const bestMissing = best.missing;
  const bestExtra = best.extra;
  const ambiguous =
    bestScore === 0 && fits.length > 1
      ? steps.slice(fits[0].index, fits[fits.length - 1].index).map((step) => step.tag)
      : [];

  // An exact match means the chain stopped cleanly after `bestIndex`
  // migrations. Anything else means the database is in no state any sequence of
  // whole migrations produces, which is what an interrupted apply leaves.
  //
  // The diff is reported against the migration that appears to have started,
  // not against the best-fit state: "eight of the nine objects this migration
  // creates are absent" is what an operator needs, where "one object more than
  // the previous state" is not.
  let partial: MigrationPlan["partial"] = null;
  if (bestScore !== 0) {
    const interrupted = steps[bestIndex];
    if (interrupted) {
      const introduced = [...interrupted.introduces];
      partial = {
        tag: interrupted.tag,
        present: introduced.filter((entry) => comparable.has(entry)).sort(),
        missing: introduced.filter((entry) => !comparable.has(entry)).sort(),
      };
    } else {
      partial = {
        tag: steps[steps.length - 1].tag,
        present: bestExtra.sort(),
        missing: bestMissing.sort(),
      };
    }
  }

  return {
    appliedThrough: bestIndex - 1,
    appliedTags: steps.slice(0, bestIndex).map((step) => step.tag),
    remainingTags: steps.slice(bestIndex).map((step) => step.tag),
    partial,
    unexpected,
    ambiguous,
  };
}

/**
 * Accepts what a read-only catalogue query returns, in either of the shapes a
 * person is likely to have: the JSON a D1 query prints, or plain lines.
 * Anything it cannot read is an error rather than an empty result, because an
 * empty result would read as "nothing is applied" and invite a full re-apply.
 */
export function parseDeployedObjects(raw: string): SchemaObject[] {
  const text = raw.trim();
  if (text === "") throw new Error("the catalogue is empty; a successful query returns at least the sqlite_schema rows");

  if (text.startsWith("[") || text.startsWith("{")) {
    const parsed = JSON.parse(text);
    // D1 and wrangler wrap results in several shapes; find the first array of
    // rows rather than assuming one.
    const rows = findRows(parsed);
    if (!rows) throw new Error("no array of {type,name} rows was found in the JSON");
    return rows.map(toObject);
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^(type|-+|\s*\|)/i.test(line))
    .map((line) => {
      const [type, name] = line.split(/[|\t,]|\s+/).filter(Boolean);
      return toObject({ type, name });
    });
}

function findRows(value: unknown): Array<{ type?: unknown; name?: unknown }> | null {
  if (Array.isArray(value)) {
    // An empty array is not a set of rows: reporting it as one would say the
    // database is empty, which invites re-applying the whole chain.
    if (value.length === 0) return null;
    const looksLikeRows = value.some(
      (entry) => entry && typeof entry === "object" && ("name" in entry || "type" in entry),
    );
    if (looksLikeRows) return value as Array<{ type?: unknown; name?: unknown }>;
    // Query tools wrap results in a result/results envelope; look inside rather
    // than assuming one shape.
    for (const entry of value) {
      const found = findRows(entry);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const found = findRows(nested);
      if (found) return found;
    }
  }
  return null;
}

function toObject(row: { type?: unknown; name?: unknown }): SchemaObject {
  const type = String(row.type ?? "").toLowerCase();
  const name = String(row.name ?? "");
  if (!name) throw new Error("a row has no object name");
  if (type !== "table" && type !== "index" && type !== "trigger") {
    throw new Error(`unexpected object type ${JSON.stringify(type)} for ${name}`);
  }
  return { type, name };
}
