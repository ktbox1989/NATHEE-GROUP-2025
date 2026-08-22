import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SITE_CONTENT, parseCmsPageContent, type CmsPageContent } from "../lib/site-cms-content.ts";
import { DEFAULT_SITE_SETTINGS } from "../lib/site-settings-content.ts";
import {
  collectPageReferences,
  collectSettingsReferences,
  firstUnpublishableLabel,
  hasPublishableReferences,
  unpublishableReferences,
} from "../lib/site-cms-publish.ts";
import { cmsErrorMessage, parseMissingReference } from "../lib/site-cms-messages.ts";

function resolution(images: string[] = [], categories: string[] = []) {
  return {
    publishableImageItemIds: new Set(images),
    publishableCategorySlugs: new Set(categories),
  };
}

function pageWith(sections: Array<Partial<CmsPageContent["sections"][number]>>): CmsPageContent {
  const content = parseCmsPageContent({
    version: 1,
    seo: { title: "หัวข้อทดสอบ", description: "คำอธิบายสำหรับหน้าทดสอบที่ยาวพอสำหรับการตรวจสอบ" },
    sections: sections.map((section, index) => ({
      id: `section-${index}`,
      type: "CONTENT",
      enabled: true,
      eyebrow: "",
      heading: "หัวข้อ Section",
      body: "",
      imageItemId: "",
      primaryLabel: "",
      primaryHref: "",
      secondaryLabel: "",
      secondaryHref: "",
      galleryCategorySlug: "",
      galleryLimit: 12,
      items: [],
      ...section,
    })),
  });
  assert.ok(content, "the fixture must be valid CMS content");
  return content;
}

test("a revision's references are the media a reader would actually be shown", () => {
  const content = pageWith([
    { imageItemId: "hero-image" },
    { type: "GALLERY", galleryCategorySlug: "transport" },
  ]);
  assert.deepEqual(collectPageReferences(content), {
    imageItemIds: ["hero-image"],
    galleryCategorySlugs: ["transport"],
  });
});

test("a disabled section is not checked, because it is not rendered", () => {
  const content = pageWith([
    { imageItemId: "shown-image" },
    { enabled: false, imageItemId: "hidden-image" },
    { enabled: false, type: "GALLERY", galleryCategorySlug: "hidden-category" },
  ]);
  assert.deepEqual(collectPageReferences(content), {
    imageItemIds: ["shown-image"],
    galleryCategorySlugs: [],
  });
});

test("an empty gallery category means every category and needs no particular one", () => {
  const content = pageWith([{ type: "GALLERY", galleryCategorySlug: "" }]);
  assert.deepEqual(collectPageReferences(content).galleryCategorySlugs, []);
});

test("a category on a non-gallery section is not a reference the renderer uses", () => {
  const content = pageWith([{ type: "CONTENT", galleryCategorySlug: "transport" }]);
  assert.deepEqual(collectPageReferences(content).galleryCategorySlugs, []);
});

test("the same image used twice is one reference", () => {
  const content = pageWith([{ imageItemId: "shared" }, { imageItemId: "shared" }]);
  assert.deepEqual(collectPageReferences(content).imageItemIds, ["shared"]);
});

test("a publish is refused when a reader could not be served the media", () => {
  const references = { imageItemIds: ["missing-image"], galleryCategorySlugs: [] };
  assert.equal(hasPublishableReferences(references, resolution()), false);
  assert.deepEqual(unpublishableReferences(references, resolution()), [
    { kind: "image", id: "missing-image" },
  ]);
  assert.equal(hasPublishableReferences(references, resolution(["missing-image"])), true);
});

test("an unresolvable gallery category is refused as well", () => {
  const references = { imageItemIds: [], galleryCategorySlugs: ["nowhere"] };
  assert.deepEqual(unpublishableReferences(references, resolution()), [
    { kind: "category", id: "nowhere" },
  ]);
  assert.equal(hasPublishableReferences(references, resolution([], ["nowhere"])), true);
});

test("a revision with no media publishes without needing anything resolved", () => {
  const content = pageWith([{ heading: "ข้อความล้วน" }]);
  assert.equal(hasPublishableReferences(collectPageReferences(content), resolution()), true);
});

test("images are reported before categories, and the order is stable", () => {
  const references = { imageItemIds: ["b-image", "a-image"], galleryCategorySlugs: ["z-category"] };
  assert.deepEqual(unpublishableReferences(references, resolution()), [
    { kind: "image", id: "b-image" },
    { kind: "image", id: "a-image" },
    { kind: "category", id: "z-category" },
  ]);
});

test("the reported label is bounded and carries nothing that is not an identifier", () => {
  assert.equal(firstUnpublishableLabel([]), null);
  assert.equal(firstUnpublishableLabel([{ kind: "image", id: "hero-01" }]), "image:hero-01");
  assert.equal(
    firstUnpublishableLabel([{ kind: "category", id: '"><script>alert(1)</script>' }]),
    "category:scriptalert1script",
  );
  assert.equal(firstUnpublishableLabel([{ kind: "image", id: "!!!" }]), "image");
  assert.equal(firstUnpublishableLabel([{ kind: "image", id: "a".repeat(200) }])?.length, 86);
});

test("the settings reference is the brand logo, which every public page shows", () => {
  assert.deepEqual(collectSettingsReferences(DEFAULT_SITE_SETTINGS), {
    imageItemIds: DEFAULT_SITE_SETTINGS.brand.logoItemId ? [DEFAULT_SITE_SETTINGS.brand.logoItemId] : [],
    galleryCategorySlugs: [],
  });
  const withLogo = { ...DEFAULT_SITE_SETTINGS, brand: { ...DEFAULT_SITE_SETTINGS.brand, logoItemId: "brand-logo" } };
  assert.deepEqual(collectSettingsReferences(withLogo).imageItemIds, ["brand-logo"]);
});

test("every page that ships with the site declares references the contract can check", () => {
  for (const [slug, content] of Object.entries(DEFAULT_SITE_CONTENT)) {
    const references = collectPageReferences(content);
    assert.ok(Array.isArray(references.imageItemIds), slug);
    for (const id of references.imageItemIds) {
      assert.match(id, /^[A-Za-z0-9_-]+$/, `${slug} references an unusable image id`);
    }
  }
});

test("a refusal tells the editor which reference to fix", () => {
  assert.match(cmsErrorMessage("unpublishable_media", "image:hero-01") ?? "", /ภาพ: hero-01/);
  assert.match(cmsErrorMessage("unpublishable_media", "category:transport") ?? "", /หมวด Gallery: transport/);
  assert.equal(cmsErrorMessage(undefined), null);
});

test("an unknown or hostile error code renders as an identifier, never as markup", () => {
  assert.equal(cmsErrorMessage("something_new"), "ไม่สำเร็จ: something_new");
  assert.equal(cmsErrorMessage("<script>alert(1)</script>"), "ไม่สำเร็จ: scriptalert1script");
  assert.match(cmsErrorMessage("publish_failed") ?? "", /เผยแพร่ไม่สำเร็จ/);
});

test("the failing reference is validated on read rather than trusted", () => {
  assert.deepEqual(parseMissingReference("image:hero-01"), { kind: "image", id: "hero-01" });
  for (const invalid of [
    undefined,
    "",
    "image:",
    "video:hero",
    "image:../../etc/passwd",
    "image:<script>",
    `image:${"a".repeat(81)}`,
    "image:hero:extra",
  ]) {
    assert.equal(parseMissingReference(invalid), null, String(invalid));
  }
  assert.equal(cmsErrorMessage("unpublishable_media", "image:<script>"), cmsErrorMessage("unpublishable_media"));
});
