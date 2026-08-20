import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePrintCenterSearch,
  parsePrintCenterKind,
  PRINT_CENTER_PAGE_SIZE,
  PRINT_CENTER_SEARCH_KINDS,
} from "../lib/print-center.ts";

test("Print Center accepts only real bounded search contracts", () => {
  for (const kind of PRINT_CENTER_SEARCH_KINDS) assert.equal(parsePrintCenterKind(kind), kind);
  assert.equal(parsePrintCenterKind(), "job");
  assert.equal(parsePrintCenterKind("invoice"), null);
  assert.equal(PRINT_CENTER_PAGE_SIZE, 50);
});

test("Print Center normalizes identifiers and rejects wildcard scans", () => {
  assert.equal(normalizePrintCenterSearch("  job-2026-000001 "), "JOB-2026-000001");
  assert.equal(normalizePrintCenterSearch("กข 1234"), "กข 1234");
  assert.equal(normalizePrintCenterSearch(""), null);
  assert.equal(normalizePrintCenterSearch("x"), undefined);
  assert.equal(normalizePrintCenterSearch("JOB*"), undefined);
  assert.equal(normalizePrintCenterSearch("[A-Z]"), undefined);
});
