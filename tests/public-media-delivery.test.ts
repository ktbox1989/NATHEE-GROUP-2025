import assert from "node:assert/strict";
import test from "node:test";
import { validateMediaSrc } from "../lib/public-cms/contract.ts";
import {
  buildPublicMediaPath,
  contentTypeForPublicMediaFormat,
  isPublicGalleryItemId,
  parsePublicMediaPath,
  publicMediaFormatForContentType,
  publicMediaRoleForStoredRole,
  PUBLIC_MEDIA_CACHE_CONTROL,
  PUBLIC_MEDIA_FORMATS,
  PUBLIC_MEDIA_PATH_PREFIX,
  PUBLIC_MEDIA_ROLES,
} from "../lib/public-media-delivery.ts";

const ITEM = "0f1e2d3c-4b5a-4968-8776-655443322110";

// The property the whole delivery contract exists for. A path that the public
// contract refuses is a payload that fails on the public site rather than at
// publish time, which is the failure nobody sees.
test("every path this contract can produce is one the public contract accepts", () => {
  let produced = 0;
  for (const role of PUBLIC_MEDIA_ROLES) {
    for (const format of PUBLIC_MEDIA_FORMATS) {
      const path = buildPublicMediaPath({ itemId: ITEM, role, format });
      assert.ok(path, `${role}/${format} produced no path`);
      assert.deepEqual(validateMediaSrc(path, "src"), [], `${path} was refused by the public contract`);
      produced += 1;
    }
  }
  assert.equal(produced, PUBLIC_MEDIA_ROLES.length * PUBLIC_MEDIA_FORMATS.length);
});

test("a produced path parses back to exactly what produced it", () => {
  for (const role of PUBLIC_MEDIA_ROLES) {
    for (const format of PUBLIC_MEDIA_FORMATS) {
      const path = buildPublicMediaPath({ itemId: ITEM, role, format })!;
      assert.deepEqual(parsePublicMediaPath(path), { itemId: ITEM, role, format });
    }
  }
});

test("the manifest's hyphenated ids and a D1 uuid are both servable identities", () => {
  for (const id of [ITEM, "motorcycle-truck-loading-01", "a", "a1"]) {
    assert.ok(isPublicGalleryItemId(id), `${id} was refused`);
    const path = buildPublicMediaPath({ itemId: id, role: "display", format: "jpeg" });
    assert.equal(path, `${PUBLIC_MEDIA_PATH_PREFIX}${id}/display.jpg`);
  }
});

test("an id that could be a traversal, a key or an encoded byte is not an identity", () => {
  for (const id of [
    "..",
    "../secrets",
    "-leading",
    "trailing-",
    "Upper",
    "with space",
    "gallery/abc",
    "a%2e%2e",
    "ไทย",
    "",
    "a".repeat(81),
  ]) {
    assert.equal(isPublicGalleryItemId(id), false, `${JSON.stringify(id)} was accepted as an id`);
    assert.equal(buildPublicMediaPath({ itemId: id, role: "display", format: "jpeg" }), null);
  }
});

test("the original upload has no public role and therefore no URL", () => {
  assert.equal(publicMediaRoleForStoredRole("ORIGINAL"), null);
  assert.equal(publicMediaRoleForStoredRole("DISPLAY"), "display");
  assert.equal(publicMediaRoleForStoredRole("THUMBNAIL"), "thumbnail");
  // Not merely absent from the map — absent from the roles a path may carry.
  assert.equal(PUBLIC_MEDIA_ROLES.includes("original" as never), false);
  assert.equal(parsePublicMediaPath(`${PUBLIC_MEDIA_PATH_PREFIX}${ITEM}/original.jpg`), null);
});

// The library accepts HEIC and HEIF on upload because a phone produces them.
// No browser is required to decode either, so neither may be handed to a
// visitor: they have no public format and therefore no path.
test("a format no browser must decode cannot be served", () => {
  for (const contentType of ["image/heic", "image/heif", "image/gif", "image/svg+xml", "text/html"]) {
    assert.equal(publicMediaFormatForContentType(contentType), null, `${contentType} was given a public format`);
  }
  for (const [contentType, format] of [
    ["image/jpeg", "jpeg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/avif", "avif"],
  ] as const) {
    assert.equal(publicMediaFormatForContentType(contentType), format);
    assert.equal(contentTypeForPublicMediaFormat(format), contentType);
  }
});

test("a path the contract would never have written is not answered", () => {
  for (const path of [
    "/api/gallery/images/abc",
    "/assets/gallery/abc-display.jpg",
    `${PUBLIC_MEDIA_PATH_PREFIX}${ITEM}/display.heic`,
    `${PUBLIC_MEDIA_PATH_PREFIX}${ITEM}/display`,
    `${PUBLIC_MEDIA_PATH_PREFIX}${ITEM}/display.jpg/extra`,
    `${PUBLIC_MEDIA_PATH_PREFIX}${ITEM}/.jpg`,
    `${PUBLIC_MEDIA_PATH_PREFIX}../../etc/passwd`,
    `${PUBLIC_MEDIA_PATH_PREFIX}${ITEM}%2Fdisplay.jpg`,
    `${PUBLIC_MEDIA_PATH_PREFIX}${ITEM}\\display.jpg`,
    `${PUBLIC_MEDIA_PATH_PREFIX}`,
    "",
    null,
    undefined,
    42,
  ]) {
    assert.equal(parsePublicMediaPath(path as never), null, `${String(path)} was parsed as a servable identity`);
  }
});

// A withdrawn photograph has to stop being served even by a cache nobody can
// purge, so the shared lifetime is bounded rather than immutable.
test("public media is shareable but not cached forever", () => {
  assert.match(PUBLIC_MEDIA_CACHE_CONTROL, /^public, max-age=(\d+), stale-while-revalidate=\d+$/);
  const maxAge = Number(/max-age=(\d+)/.exec(PUBLIC_MEDIA_CACHE_CONTROL)![1]);
  assert.ok(maxAge > 0 && maxAge <= 86400, `max-age ${maxAge} is not a bounded window`);
  assert.equal(PUBLIC_MEDIA_CACHE_CONTROL.includes("immutable"), false);
});
