#!/usr/bin/env node
// What is left to apply to the Production D1 database, computed from the
// database rather than assumed from the repository.
//
// This repository has no migration runner, so drizzle/meta/_journal.json says
// which migrations exist, not which have been applied. The deployed schema is
// what can answer that, and it is obtained with one read-only query:
//
//   SELECT type, name FROM sqlite_schema WHERE type IN ('table','index','trigger');
//
// Save that output and pass the file. Nothing here connects to Production, and
// nothing here applies anything.
//
// Usage: node scripts/plan-d1-migrations.mjs <catalogue-file>

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrationSteps, parseDeployedObjects, planMigrations } from "../lib/d1-migration-plan.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cataloguePath = process.argv[2];

if (!cataloguePath) {
  console.error("usage: node scripts/plan-d1-migrations.mjs <catalogue-file>");
  console.error("");
  console.error("Obtain the catalogue from the Production database with the read-only query:");
  console.error("  SELECT type, name FROM sqlite_schema WHERE type IN ('table','index','trigger');");
  process.exitCode = 2;
} else {
  const migrationsDirectory = join(root, "drizzle");
  const sources = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort()
    .map((name) => ({ tag: name.replace(/\.sql$/, ""), sql: readFileSync(join(migrationsDirectory, name), "utf8") }));

  const steps = migrationSteps(sources);

  let deployed;
  try {
    deployed = parseDeployedObjects(readFileSync(cataloguePath, "utf8"));
  } catch (error) {
    console.error(`D1_PLAN_FAIL could not read the catalogue: ${error?.message ?? error}`);
    console.error("An unreadable catalogue is refused rather than treated as an empty database,");
    console.error("because an empty result would read as nothing applied and invite a full re-apply.");
    process.exitCode = 1;
    process.exit();
  }

  const plan = planMigrations(steps, deployed);

  console.log(`migrations in repository  ${steps.length} (${steps[0]?.tag} .. ${steps[steps.length - 1]?.tag})`);
  console.log(`objects in the database   ${deployed.length}`);
  console.log("");

  if (plan.partial) {
    console.log(`D1_PLAN_PARTIAL ${plan.partial.tag} is half applied`);
    console.log(`  present (${plan.partial.present.length}): ${plan.partial.present.join(", ")}`);
    console.log(`  missing (${plan.partial.missing.length}): ${plan.partial.missing.join(", ")}`);
    console.log("");
    console.log("Do not apply anything on top of this. Restore the backup taken before the");
    console.log("apply, fix the cause, and start again. Continuing from a partial apply is the");
    console.log("state that is hardest to reason about and has no clean forward path.");
    process.exitCode = 1;
  } else if (plan.remainingTags.length === 0) {
    console.log(`D1_PLAN_CURRENT all ${steps.length} migrations are applied`);
    console.log("Verify the runtime agrees: /api/health must report database: true.");
  } else {
    console.log(
      `D1_PLAN_PENDING applied=${plan.appliedTags.length} remaining=${plan.remainingTags.length}`,
    );
    console.log("");
    console.log("Apply these, in this order, once each:");
    for (const tag of plan.remainingTags) console.log(`  drizzle/${tag}.sql`);
    console.log("");
    console.log("Take the backup first. It is the only rollback path.");
    process.exitCode = 1;
  }

  if (plan.unexpected.length > 0) {
    console.log("");
    console.log(`note: ${plan.unexpected.length} object(s) present that no migration creates:`);
    for (const entry of plan.unexpected) console.log(`  ${entry}`);
    console.log("These were not created by this repository. Confirm what put them there.");
  }
}
