import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = [
  "app/api/gallery/route.ts",
  "app/api/motorcycles/[id]/images/route.ts",
  "app/api/quotation/route.ts",
];

test("object-storage mutation routes register candidate keys before ambiguous R2 writes", async () => {
  for (const route of routes) {
    const source = await readFile(route, "utf8");
    const pushPositions = [...source.matchAll(/storedKeys\.push\(/g)].map((match) => match.index ?? -1);
    const putPositions = [...source.matchAll(/await env\.FILES\.put\(/g)].map((match) => match.index ?? -1);
    assert.equal(pushPositions.length, putPositions.length, `${route}: every R2 write needs one cleanup candidate`);
    for (let index = 0; index < putPositions.length; index += 1) {
      assert.ok(pushPositions[index] < putPositions[index], `${route}: cleanup key must be recorded before R2 put`);
    }
    assert.match(source, /Promise\.allSettled\(storedKeys\.map/);
  }
});

test("image mutation routes report cleanup uncertainty instead of throwing or claiming success", async () => {
  const gallery = await readFile("app/api/gallery/route.ts", "utf8");
  const evidence = await readFile("app/api/motorcycles/[id]/images/route.ts", "utf8");
  assert.match(gallery, /gallery_cleanup/);
  assert.match(evidence, /image_cleanup/);
  assert.doesNotMatch(evidence, /await Promise\.all\(storedKeys\.map/);
});

test("every heavy multipart route uses the shared fail-closed request bound", async () => {
  for (const route of [
    "app/api/gallery/route.ts",
    "app/api/motorcycles/[id]/images/route.ts",
    "app/api/motorcycles/[id]/pod/route.ts",
    "app/api/motorcycles/imports/route.ts",
    "app/api/quotation/route.ts",
  ]) {
    assert.match(await readFile(route, "utf8"), /validateBoundedMultipartRequest\(/, route);
  }
});
