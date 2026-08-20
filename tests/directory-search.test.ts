import assert from "node:assert/strict";
import test from "node:test";
import { DIRECTORY_PAGE_SIZE, normalizeDirectorySearch, parseCreatedCursor } from "../lib/directory-search.ts";

test("directory prefix search is bounded and cannot inject wildcard scans", () => {
  assert.equal(normalizeDirectorySearch("  CUS-000123  "), "CUS-000123");
  assert.equal(normalizeDirectorySearch("บริษัท   นที"), "บริษัท นที");
  assert.equal(normalizeDirectorySearch(""), null);
  assert.equal(normalizeDirectorySearch("x"), undefined);
  assert.equal(normalizeDirectorySearch("CUS*"), undefined);
  assert.equal(normalizeDirectorySearch("a".repeat(81)), undefined);
  assert.equal(DIRECTORY_PAGE_SIZE, 50);
});

test("created cursor requires a complete valid pair", () => {
  assert.equal(parseCreatedCursor(), undefined);
  assert.deepEqual(parseCreatedCursor("2026-08-21T10:00:00.000Z", "job-a"), {
    createdAt: "2026-08-21T10:00:00.000Z",
    id: "job-a",
  });
  assert.equal(parseCreatedCursor("invalid", "job-a"), null);
  assert.equal(parseCreatedCursor("2026-08-21T10:00:00.000Z"), null);
});
