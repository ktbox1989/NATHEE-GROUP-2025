#!/usr/bin/env node
// Gates must not depend on how the tree was checked out.
//
// This class of defect has appeared three times in this repository: the
// response-header gate, the apex-regression guard, and every mutation-based
// negative suite. Each time the cause was the same — a check anchored to a
// literal "\n" matched nothing on a CRLF checkout.
//
// The two failure modes are not equally bad. A mutation suite that stops
// matching aborts loudly with "mutation changed nothing", which is annoying but
// honest. A *guard* that stops matching passes silently, and a gate that cannot
// fail is worse than no gate, because it gets reported as evidence.
//
// Two rules:
//   1. Every suite that mutates source by string replacement must do something
//      deliberate about carriage returns.
//   2. The apex-regression guard must compare per line rather than against a
//      literal newline, and must still check all three apex values.

import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDirectory = join(root, "scripts");

const failures = [];
const note = (message) => failures.push(message);

// Matches the two-character escape sequence: the suite says something about
// carriage returns rather than assuming they cannot occur. Testing for the
// escape is robust; matching an exact idiom spelling is not, and proved fragile
// enough to make this gate vacuous on its first attempt.
const HANDLES_CARRIAGE_RETURN = /\\r/;

// A suite that mutates a copied tree, whichever replacement idiom it uses.
const MUTATES_SOURCE = /\.replace(?:All)?\(/;

const entries = await readdir(scriptsDirectory);
const mutationSuites = entries.filter((name) => name.endsWith("-negative.mjs")).sort();
if (mutationSuites.length === 0) {
  note("no mutation suites found; this scan is not looking where it thinks it is");
}

let checked = 0;
for (const name of mutationSuites) {
  const source = await readFile(join(scriptsDirectory, name), "utf8");
  if (!MUTATES_SOURCE.test(source)) continue;
  checked += 1;
  if (!HANDLES_CARRIAGE_RETURN.test(source)) {
    note(
      `${name} mutates source by replacement but never mentions a carriage return; ` +
        "on a CRLF checkout its anchors match nothing and every case becomes a no-op",
    );
  }
}
if (checked !== mutationSuites.length) {
  note(`only ${checked} of ${mutationSuites.length} mutation suites were inspected`);
}

// The apex-regression guard is the one that fails silently, so it is checked
// more closely than the suites.
const canonicalGuard = await readFile(join(scriptsDirectory, "test-canonical-domain.mjs"), "utf8");

if (!canonicalGuard.includes("trimEnd()") && !HANDLES_CARRIAGE_RETURN.test(canonicalGuard)) {
  note("test-canonical-domain.mjs does not neutralise carriage returns before comparing");
}
if (!canonicalGuard.includes("split(") || !canonicalGuard.includes("lines")) {
  note("test-canonical-domain.mjs no longer compares per line");
}

// The three apex values it must refuse. Reducing these to one would leave the
// gate passing while the regression it exists to catch walked straight through.
for (const value of ["APP_ORIGIN=", "Site URL: ", "Callback: "]) {
  if (!canonicalGuard.includes(value)) {
    note(`test-canonical-domain.mjs no longer checks the apex form of "${value.trim()}"`);
  }
}

for (const failure of failures) process.stderr.write(`LINE_ENDING_INDEPENDENCE_FAIL ${failure}\n`);
if (failures.length > 0) {
  process.stderr.write(`LINE_ENDING_INDEPENDENCE_FAIL problems=${failures.length}\n`);
  process.exit(1);
}

process.stdout.write(
  `LINE_ENDING_INDEPENDENCE_PASS mutationSuites=${checked} carriageReturnAware=${checked} canonicalGuard=per-line apexValues=3\n`,
);
