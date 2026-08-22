import assert from "node:assert/strict";
import test from "node:test";
import {
  galleryItemToMedia,
  mapCmsPageToPublicPage,
  toPublicRoutePath,
  type CmsPageStateInput,
} from "../lib/public-cms/map-from-cms.ts";

// The mapper is the only place Lane B's data becomes something a visitor sees,
// so it is tested from the position that the payload is untrusted and that
// refusing is always safer than guessing.

function section(overrides: Record<string, unknown> = {}) {
  return {
    id: "overview",
    type: "CONTENT",
    enabled: true,
    heading: "บริการทั้งหมด",
    body: "ข้อความ",
    imageItemId: "",
    items: [],
    ...overrides,
  };
}

function state(overrides: Record<string, unknown> = {}): CmsPageStateInput {
  return {
    status: "PUBLISHED",
    revisionId: "rev-1",
    content: {
      version: 1,
      seo: { title: "บริการ | NATHEE GROUP 2025", description: "รายละเอียดบริการขนส่ง" },
      sections: [
        section({ id: "hero", type: "HERO", heading: "บริการขนส่งที่วางแผนตามงานจริง", body: "" }),
        section(),
      ],
    },
    ...overrides,
  } as CmsPageStateInput;
}

const PUBLISHED_AT = "2026-08-23T00:00:00.000Z";

function map(overrides: Record<string, unknown> = {}) {
  return mapCmsPageToPublicPage({
    slug: "services",
    cmsPath: "/services",
    state: state(),
    publishedAt: PUBLISHED_AT,
    ...overrides,
  });
}

test("a published CMS page maps to a valid PublicPage", () => {
  const result = map();
  assert.equal(result.ok, true, result.ok ? "" : `${result.reason} ${JSON.stringify(result.violations)}`);
  if (!result.ok) return;
  assert.equal(result.page.path, "/services/");
  assert.equal(result.page.heading, "บริการขนส่งที่วางแผนตามงานจริง");
  assert.equal(result.page.seo.canonicalPath, "/services/");
  assert.equal(result.page.revisionId, "rev-1");
});

test("only PUBLISHED maps; hidden, unmanaged and broken refuse", () => {
  for (const status of ["HIDDEN", "UNMANAGED", "BROKEN"] as const) {
    const result = map({ state: state({ status, content: null, revisionId: null }) });
    assert.equal(result.ok, false, `${status} must refuse`);
    assert.match(result.ok === false ? result.reason : "", new RegExp(status.toLowerCase()));
  }
});

test("the trailing slash is normalised and unknown routes refuse", () => {
  assert.equal(toPublicRoutePath("/services"), "/services/");
  assert.equal(toPublicRoutePath("/services/"), "/services/");
  assert.equal(toPublicRoutePath("/"), "/");
  assert.equal(toPublicRoutePath("/admin"), null);
  assert.equal(map({ cmsPath: "/admin" }).ok, false);
});

test("a page with no HERO heading is refused rather than given an invented h1", () => {
  const withoutHero = state();
  withoutHero.content!.sections = [section()];
  const result = map({ state: withoutHero });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /HERO/);
});

test("a disabled HERO does not supply the heading", () => {
  const disabledHero = state();
  disabledHero.content!.sections[0].enabled = false;
  assert.equal(map({ state: disabledHero }).ok, false);
});

test("disabled sections never reach the public page", () => {
  const withDisabled = state();
  withDisabled.content!.sections.push(section({ id: "secret", heading: "ยังไม่เผยแพร่", enabled: false }));
  const result = map({ state: withDisabled });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.page.sections.some((s) => s.id === "secret"), false);
});

test("feature items become h3 under their section, preserving the outline", () => {
  const withItems = state();
  withItems.content!.sections[1].items = [
    { title: "ขนส่งในประเทศ", body: "รายละเอียด" },
    { title: "ขนส่งต่างประเทศ", body: "" },
  ];
  const result = map({ state: withItems });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.page.sections.map((s) => s.headingLevel), [2, 3, 3]);
  // The validator would have rejected a skipped level, so passing proves the
  // derived outline is sound.
  assert.equal(result.page.sections[1].heading, "ขนส่งในประเทศ");
});

test("an item without a title is skipped rather than rendered headless", () => {
  const withBlank = state();
  withBlank.content!.sections[1].items = [{ title: "   ", body: "x" }];
  const result = map({ state: withBlank });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.page.sections.length, 1);
});

// --- media -----------------------------------------------------------------

const galleryItem = {
  id: "motorcycle-truck-loading-01",
  altText: "รถบรรทุกกำลังโหลดรถจักรยานยนต์",
  caption: null,
  thumbnailSrc: "https://natheegroup2025.com/assets/gallery/a-thumbnail.webp",
  displaySrc: "https://natheegroup2025.com/assets/gallery/a-display.webp",
  width: 1600,
  height: 900,
};

test("gallery absolute URLs become same-origin paths", () => {
  const media = galleryItemToMedia(galleryItem);
  assert.ok(media);
  assert.equal(media.variants.every((variant) => variant.src.startsWith("/assets/")), true);
  assert.equal(media.variants.some((variant) => variant.role === "display"), true);
});

test("media without alt text or real dimensions is refused, never defaulted", () => {
  assert.equal(galleryItemToMedia({ ...galleryItem, altText: "" }), null);
  assert.equal(galleryItemToMedia({ ...galleryItem, altText: "   " }), null);
  assert.equal(galleryItemToMedia({ ...galleryItem, width: 0 }), null);
  assert.equal(galleryItemToMedia({ ...galleryItem, height: -1 }), null);
  assert.equal(galleryItemToMedia({ ...galleryItem, displaySrc: "not a url" }), null);
  assert.equal(galleryItemToMedia({ ...galleryItem, displaySrc: "https://x.test/a.txt" }), null);
});

test("a resolved image is attached to its section", () => {
  const withImage = state();
  withImage.content!.sections[1].imageItemId = "motorcycle-truck-loading-01";
  const result = map({ state: withImage, resolveMedia: () => galleryItemToMedia(galleryItem) });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.page.sections[0].media.length, 1);
  assert.equal(result.page.sections[0].media[0].altText, galleryItem.altText);
});

test("an unresolvable image reference drops the media, keeping the text", () => {
  const withImage = state();
  withImage.content!.sections[1].imageItemId = "deleted-item";
  const result = map({ state: withImage, resolveMedia: () => null });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.page.sections[0].media.length, 0);
  assert.equal(result.page.sections[0].body.length, 1);
});

test("private media offered by a resolver is still refused by the contract", () => {
  // Defence in depth: even if Lane B handed back an authenticated path, the
  // mapper's output must not validate.
  const withImage = state();
  withImage.content!.sections[1].imageItemId = "leak";
  const result = map({
    state: withImage,
    resolveMedia: () => ({
      id: "leak",
      altText: "หลักฐานลูกค้า",
      caption: null,
      variants: [{ src: "/api/images/secret", width: 800, height: 600, format: "jpeg", role: "display" }],
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /consumer contract/);
});

test("the mapper gets no exemption from the validator", () => {
  // A title short enough to be meaningless still has to fail, proving the
  // mapper runs its output through the same gate as any other payload.
  const badSeo = state();
  badSeo.content!.seo = { title: "", description: "" };
  const result = map({ state: badSeo });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && (result.violations?.length ?? 0) > 0);
});

test("an unsupported CMS content version is refused", () => {
  const future = state();
  (future.content as { version: number }).version = 2;
  assert.equal(map({ state: future }).ok, false);
});
