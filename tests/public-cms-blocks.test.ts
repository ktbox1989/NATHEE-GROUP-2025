import assert from "node:assert/strict";
import test from "node:test";
import type { PublicMedia } from "../lib/public-cms/contract.ts";
import {
  PUBLIC_BLOCK_TYPES,
  headingLevelOf,
  isRenderableHref,
  mediaSourcesOf,
  validateBlocks,
  validateVideoSrc,
  type PublicBlock,
} from "../lib/public-cms/blocks.ts";
import {
  BLOCKS_LANE_B_CANNOT_EXPRESS,
  CMS_SECTION_BLOCK_TYPES,
  mapCmsSectionsToBlocks,
} from "../lib/public-cms/map-blocks.ts";
import type { CmsSectionInput } from "../lib/public-cms/map-from-cms.ts";

const media: PublicMedia = {
  id: "m1",
  altText: "รถบรรทุกขนส่งรถจักรยานยนต์",
  caption: null,
  variants: [{ src: "/assets/gallery/a-display.jpg", width: 1600, height: 900, format: "jpeg", role: "display" }],
};

const hero: PublicBlock = {
  type: "HERO",
  id: "hero",
  eyebrow: "MOTORCYCLE LOGISTICS",
  heading: "ขนส่งรถจักรยานยนต์ครบวงจร",
  body: ["รองรับงานรายคันถึงงานล็อต"],
  media,
  actions: [{ label: "ขอใบเสนอราคา", href: "/quotation/" }],
};

const accept = (blocks: unknown[], options = {}) => validateBlocks(blocks, options);
const fieldsOf = (blocks: unknown[], options = {}) => {
  const result = validateBlocks(blocks, options);
  return result.ok ? [] : result.violations.map((violation) => violation.field);
};

// --- the outline the whole page produces ------------------------------------

test("a body of blocks with one hero at the front is accepted", () => {
  const result = accept([hero, { type: "TEXT", id: "t", heading: "งานจริง", headingLevel: 2, body: ["เนื้อหา"], media: [] }]);
  assert.equal(result.ok, true);
});

test("exactly one h1, and it comes first", () => {
  // Two heroes are each valid alone; the defect is only visible across the set.
  assert.ok(fieldsOf([hero, { ...hero, id: "hero-2" }]).includes("blocks"));
  assert.ok(fieldsOf([]).includes("blocks"));
  const heroSecond = [
    { type: "TEXT", id: "t", heading: "ก่อน", headingLevel: 2, body: ["x"], media: [] },
    hero,
  ];
  assert.ok(fieldsOf(heroSecond).includes("blocks[0]"), "an h1 after an h2 opens the outline at the wrong rank");
});

test("a heading level cannot be skipped across blocks", () => {
  const skipped = [hero, { type: "TEXT", id: "t", heading: "ลึกเกินไป", headingLevel: 3, body: [], media: [] }];
  assert.ok(fieldsOf(skipped).includes("blocks[1]"));
});

test("a block without a heading does not break the outline", () => {
  const result = accept([
    hero,
    { type: "TEXT", id: "a", heading: null, headingLevel: 2, body: ["ย่อหน้า"], media: [] },
    { type: "TEXT", id: "b", heading: "หัวข้อ", headingLevel: 2, body: [], media: [] },
  ]);
  assert.equal(result.ok, true);
});

test("a fragment can be validated without a hero, for a block rendered on its own", () => {
  const result = accept([{ type: "TEXT", id: "t", heading: "หัวข้อ", headingLevel: 2, body: ["x"], media: [] }], {
    requireHero: false,
  });
  assert.equal(result.ok, true);
});

test("an unknown block type is refused, never skipped", () => {
  // Skipping would silently drop content an editor believes they published.
  assert.ok(fieldsOf([hero, { type: "CAROUSEL", id: "x" }]).includes("blocks[1].type"));
  assert.ok(fieldsOf([hero, { type: "", id: "x" }]).includes("blocks[1].type"));
  assert.ok(fieldsOf([hero, null]).includes("blocks[1]"));
  assert.equal(validateBlocks("not an array").ok, false);
});

test("every declared block type is one the validator actually implements", () => {
  for (const type of PUBLIC_BLOCK_TYPES) {
    const result = validateBlocks([{ type, id: "x" }], { requireHero: false });
    assert.equal(result.ok, false, `${type} must be validated, not waved through`);
    const fields = result.ok ? [] : result.violations.map((violation) => violation.field);
    assert.equal(
      fields.some((field) => field !== "blocks[0].type"),
      true,
      `${type} produced only a type violation, so it has no rules of its own`,
    );
  }
});

// --- links --------------------------------------------------------------------

test("a link must lead somewhere the public site actually serves", () => {
  for (const href of ["/", "/services/", "/services", "/quotation/", "/news/", "/news/a-post/", "/contact/#line"]) {
    assert.equal(isRenderableHref(href), true, `${href} should be renderable`);
  }
  for (const href of ["/app/", "/api/quotation", "/auth/callback", "https://example.com/", "//example.com", "/nowhere/", "", "services"]) {
    assert.equal(isRenderableHref(href), false, `${href} must be refused`);
  }
});

test("a call to action pointing off-site or into the application is refused", () => {
  const cta = (href: string): PublicBlock => ({
    type: "CTA",
    id: "cta",
    heading: "ขอใบเสนอราคา",
    body: [],
    actions: [{ label: "เริ่ม", href }],
  });
  assert.equal(accept([hero, cta("/quotation/")]).ok, true);
  for (const href of ["https://evil.example/", "/app/jobs", "/api/quotation"]) {
    assert.ok(fieldsOf([hero, cta(href)]).includes("blocks[1].actions[0].href"), `${href} must be refused`);
  }
});

test("a button with no words on it is refused", () => {
  const blocks = [hero, { type: "CTA", id: "c", heading: "ห", body: [], actions: [{ label: "", href: "/quotation/" }] }];
  assert.ok(fieldsOf(blocks).includes("blocks[1].actions[0].label"));
});

test("a call to action with nothing to act on is refused", () => {
  assert.ok(fieldsOf([hero, { type: "CTA", id: "c", heading: "ห", body: [], actions: [] }]).includes("blocks[1].actions"));
});

// --- each block's own rules ---------------------------------------------------

test("a hero must supply the page heading", () => {
  assert.ok(fieldsOf([{ ...hero, heading: "" }]).includes("blocks[0].heading"));
  // An eyebrow is optional, but not half-present.
  assert.equal(accept([{ ...hero, eyebrow: null }]).ok, true);
  assert.ok(fieldsOf([{ ...hero, eyebrow: "" }]).includes("blocks[0].eyebrow"));
});

test("a hero offers at most two actions, because a phone stacks them", () => {
  const three = [{ ...hero, actions: [
    { label: "a", href: "/quotation/" },
    { label: "b", href: "/contact/" },
    { label: "c", href: "/gallery/" },
  ] }];
  assert.ok(fieldsOf(three).includes("blocks[0].actions"));
});

test("a card grid with no cards is refused, and so is an empty card", () => {
  const grid = (cards: unknown[]): unknown => ({ type: "SERVICE_CARDS", id: "g", heading: "บริการ", body: [], cards });
  assert.ok(fieldsOf([hero, grid([])]).includes("blocks[1].cards"));
  assert.ok(fieldsOf([hero, grid([{ title: "", body: "x", href: null }])]).includes("blocks[1].cards[0].title"));
  assert.ok(fieldsOf([hero, grid([{ title: "x", body: "", href: null }])]).includes("blocks[1].cards[0].body"));
  assert.equal(accept([hero, grid([{ title: "ขนส่ง", body: "รายละเอียด", href: "/services/" }])]).ok, true);
  assert.equal(accept([hero, grid([{ title: "ขนส่ง", body: "รายละเอียด", href: null }])]).ok, true);
});

test("an FAQ question published without an answer is refused", () => {
  // It reads as an oversight on the page, and it is emitted into FAQPage
  // structured data, where it is worse.
  const faq = (questions: unknown[]): unknown => ({ type: "FAQ", id: "f", heading: "คำถาม", questions });
  assert.ok(fieldsOf([hero, faq([{ question: "ถามอะไร", answer: "" }])]).includes("blocks[1].questions[0].answer"));
  assert.ok(fieldsOf([hero, faq([])]).includes("blocks[1].questions"));
  assert.equal(accept([hero, faq([{ question: "ถามอะไร", answer: "ตอบ" }])]).ok, true);
});

test("a gallery block names a category and a bounded count", () => {
  const gallery = (over: Record<string, unknown>): unknown => ({
    type: "GALLERY", id: "g", heading: null, body: [], categorySlug: "storage", limit: 12, ...over,
  });
  assert.equal(accept([hero, gallery({})]).ok, true);
  assert.equal(accept([hero, gallery({ categorySlug: null })]).ok, true);
  assert.ok(fieldsOf([hero, gallery({ categorySlug: "Not A Slug" })]).includes("blocks[1].categorySlug"));
  for (const limit of [0, -1, 25, 1.5, "12"]) {
    assert.ok(fieldsOf([hero, gallery({ limit })]).includes("blocks[1].limit"), `limit ${limit} must be refused`);
  }
});

test("a figure cannot be published without saying where it came from", () => {
  // The site already refuses to state unconfirmed capacity numbers. Requiring
  // provenance makes that a property of the data rather than a rule someone
  // has to remember.
  const stats = (entries: unknown[]): unknown => ({ type: "STATS", id: "s", heading: "ตัวเลข", stats: entries });
  assert.ok(fieldsOf([hero, stats([{ label: "รถต่อเดือน", value: "500", source: "" }])]).includes("blocks[1].stats[0].source"));
  assert.ok(fieldsOf([hero, stats([{ label: "รถต่อเดือน", value: "500" }])]).includes("blocks[1].stats[0].source"));
  assert.ok(fieldsOf([hero, stats([])]).includes("blocks[1].stats"));
  assert.equal(
    accept([hero, stats([{ label: "รถต่อเดือน", value: "500", source: "สรุปงานภายใน ม.ค.–มิ.ย. 2569" }])]).ok,
    true,
  );
});

test("an image block carries real media and an optional caption", () => {
  const image = (over: Record<string, unknown>): unknown => ({ type: "IMAGE", id: "i", heading: null, media, caption: null, ...over });
  assert.equal(accept([hero, image({})]).ok, true);
  assert.ok(fieldsOf([hero, image({ media: { ...media, altText: "" } })]).includes("blocks[1].media.altText"));
  assert.ok(fieldsOf([hero, image({ caption: "" })]).includes("blocks[1].caption"));
});

test("related services must lead to real routes and cannot be empty", () => {
  const related = (links: unknown[]): unknown => ({ type: "RELATED_SERVICES", id: "r", heading: "บริการอื่น", links });
  assert.ok(fieldsOf([hero, related([])]).includes("blocks[1].links"));
  assert.equal(accept([hero, related([{ label: "รับฝากรถ", href: "/storage/" }])]).ok, true);
  assert.ok(fieldsOf([hero, related([{ label: "ระบบ", href: "/app/" }])]).includes("blocks[1].links[0].href"));
});

test("featured work is bounded and optionally scoped to a category", () => {
  const featured = (over: Record<string, unknown>): unknown => ({
    type: "FEATURED_WORK", id: "w", heading: "ผลงาน", limit: 6, categorySlug: null, ...over,
  });
  assert.equal(accept([hero, featured({})]).ok, true);
  assert.ok(fieldsOf([hero, featured({ limit: 0 })]).includes("blocks[1].limit"));
  assert.ok(fieldsOf([hero, featured({ limit: 13 })]).includes("blocks[1].limit"));
  assert.ok(fieldsOf([hero, featured({ categorySlug: "BAD SLUG" })]).includes("blocks[1].categorySlug"));
});

test("a contact block does not carry the telephone numbers", () => {
  // They come from published site settings, so changing them changes them
  // everywhere at once rather than in whichever block someone remembered.
  const result = accept([hero, { type: "CONTACT", id: "c", heading: "ติดต่อ", body: ["รายละเอียด"] }]);
  assert.equal(result.ok, true);
  const block = result.ok ? result.blocks[1] : null;
  assert.equal(block && "telephones" in block, false);
});

// --- video: the CSP decides this, not a preference ---------------------------

test("an external embed is refused because the public CSP blocks it", () => {
  // frame-src and media-src are both absent from the policy, so they fall back
  // to default-src 'self'. A YouTube embed renders an empty box and an external
  // <video src> never loads — so accepting one would let an editor publish a
  // video that cannot play and hear about it from a customer.
  for (const src of [
    "https://www.youtube.com/embed/abc",
    "https://player.vimeo.com/video/1",
    "//cdn.example.com/a.mp4",
    "http://example.com/a.mp4",
  ]) {
    const violations = validateVideoSrc(src, "src");
    assert.ok(violations.length > 0, `${src} must be refused`);
    assert.match(violations[0].reason, /CSP|same-origin/);
  }
});

test("a self-hosted video is accepted, with a poster and optional captions", () => {
  assert.deepEqual(validateVideoSrc("/assets/video/loading.mp4", "src"), []);
  assert.deepEqual(validateVideoSrc("/assets/video/loading.webm", "src"), []);
  assert.ok(validateVideoSrc("/assets/video/loading.mov", "src").length > 0);
  assert.ok(validateVideoSrc("/assets/../etc/passwd.mp4", "src").length > 0);

  const video = (over: Record<string, unknown>): unknown => ({
    type: "VIDEO", id: "v", heading: null, src: "/assets/video/a.mp4", poster: media, captionsSrc: null, ...over,
  });
  assert.equal(accept([hero, video({})]).ok, true);
  assert.equal(accept([hero, video({ captionsSrc: "/assets/video/a.vtt" })]).ok, true);
  assert.ok(fieldsOf([hero, video({ captionsSrc: "/assets/video/a.srt" })]).includes("blocks[1].captionsSrc"));
  // A poster with no real dimensions reserves no space and the page reflows.
  assert.ok(fieldsOf([hero, video({ poster: { ...media, variants: [] } })]).some((f) => f.startsWith("blocks[1].poster")));
});

// --- private media cannot reach any block ------------------------------------

test("no block will render an authenticated media path", () => {
  const leaked = (src: string): PublicMedia => ({
    ...media,
    variants: [{ src, width: 800, height: 600, format: "jpeg", role: "display" }],
  });
  for (const src of ["/api/motorcycles/1/photo.jpg", "/app/jobs/2/pod.jpg", "/auth/x.png", "https://cdn.example/a.jpg"]) {
    assert.ok(fieldsOf([{ ...hero, media: leaked(src) }]).length > 0, `hero must refuse ${src}`);
    assert.ok(
      fieldsOf([hero, { type: "IMAGE", id: "i", heading: null, media: leaked(src), caption: null }]).length > 0,
      `image must refuse ${src}`,
    );
    assert.ok(
      fieldsOf([hero, { type: "TEXT", id: "t", heading: null, headingLevel: 2, body: [], media: [leaked(src)] }]).length > 0,
      `text must refuse ${src}`,
    );
    assert.ok(
      fieldsOf([hero, { type: "VIDEO", id: "v", heading: null, src: "/assets/v.mp4", poster: leaked(src), captionsSrc: null }]).length > 0,
      `video poster must refuse ${src}`,
    );
  }
});

test("the media a page depends on can be listed without a wildcard purge", () => {
  const sources = mediaSourcesOf([
    hero,
    { type: "IMAGE", id: "i", heading: null, media, caption: null },
    { type: "VIDEO", id: "v", heading: null, src: "/assets/video/a.mp4", poster: media, captionsSrc: "/assets/video/a.vtt" },
  ]);
  assert.deepEqual(sources, ["/assets/gallery/a-display.jpg", "/assets/video/a.mp4", "/assets/video/a.vtt"]);
});

test("heading rank is stated per block rather than inferred by the renderer", () => {
  assert.equal(headingLevelOf(hero), 1);
  assert.equal(headingLevelOf({ type: "TEXT", id: "t", heading: null, headingLevel: 2, body: [], media: [] }), null);
  assert.equal(headingLevelOf({ type: "FAQ", id: "f", heading: "ถาม", questions: [{ question: "a", answer: "b" }] }), 2);
});

// --- mapping Lane B's sections ------------------------------------------------

function section(over: Partial<CmsSectionInput> = {}): CmsSectionInput {
  return {
    id: "s1",
    type: "CONTENT",
    enabled: true,
    heading: "หัวข้อ",
    body: "เนื้อหา",
    imageItemId: "",
    items: [],
    ...over,
  };
}

const heroSection = section({
  id: "home-hero",
  type: "HERO",
  heading: "ขนส่งรถจักรยานยนต์",
  eyebrow: "MOTORCYCLE LOGISTICS",
  primaryLabel: "ขอใบเสนอราคา",
  primaryHref: "/quotation",
});

test("every section type Lane B defines maps to a block", () => {
  for (const type of ["HERO", "CONTENT", "FEATURES", "GALLERY", "FAQ", "CTA", "CONTACT"]) {
    assert.ok(CMS_SECTION_BLOCK_TYPES[type], `${type} has no block`);
  }
});

test("the buttons the old mapper dropped now survive", () => {
  // This is the defect: primaryLabel/Href and secondaryLabel/Href were read by
  // nothing, so a CMS page rendered without the "ขอใบเสนอราคา" button the
  // static page has.
  const result = mapCmsSectionsToBlocks([
    section({
      ...heroSection,
      secondaryLabel: "ดูผลงาน",
      secondaryHref: "/gallery",
    }),
  ]);
  assert.equal(result.ok, true);
  const block = result.ok ? result.blocks[0] : null;
  assert.equal(block?.type, "HERO");
  assert.deepEqual(block?.type === "HERO" ? block.actions : [], [
    { label: "ขอใบเสนอราคา", href: "/quotation/" },
    { label: "ดูผลงาน", href: "/gallery/" },
  ]);
  assert.equal(block?.type === "HERO" ? block.eyebrow : null, "MOTORCYCLE LOGISTICS");
});

test("a button pointing somewhere the site does not serve is dropped, not rendered", () => {
  const result = mapCmsSectionsToBlocks([
    section({ ...heroSection, secondaryLabel: "ระบบภายใน", secondaryHref: "/app/jobs" }),
  ]);
  assert.equal(result.ok, true);
  const block = result.ok ? result.blocks[0] : null;
  assert.equal(block?.type === "HERO" ? block.actions.length : -1, 1, "only the valid action survives");
});

test("a FAQ section becomes an FAQ block rather than generic headings", () => {
  const result = mapCmsSectionsToBlocks([
    heroSection,
    section({ id: "faq", type: "FAQ", heading: "คำถามที่พบบ่อย", items: [{ title: "ถามอะไร", body: "ตอบอย่างนี้" }] }),
  ]);
  assert.equal(result.ok, true);
  const block = result.ok ? result.blocks[1] : null;
  assert.equal(block?.type, "FAQ");
  assert.deepEqual(block?.type === "FAQ" ? block.questions : [], [{ question: "ถามอะไร", answer: "ตอบอย่างนี้" }]);
});

test("a features section becomes a card grid", () => {
  const result = mapCmsSectionsToBlocks([
    heroSection,
    section({ id: "svc", type: "FEATURES", heading: "บริการ", items: [{ title: "ขนส่ง", body: "รายละเอียด" }] }),
  ]);
  const block = result.ok ? result.blocks[1] : null;
  assert.equal(block?.type, "SERVICE_CARDS");
  assert.deepEqual(block?.type === "SERVICE_CARDS" ? block.cards : [], [
    { title: "ขนส่ง", body: "รายละเอียด", href: null },
  ]);
});

test("a gallery section keeps the category and count it was configured with", () => {
  const result = mapCmsSectionsToBlocks([
    heroSection,
    section({ id: "g", type: "GALLERY", heading: "ผลงาน", galleryCategorySlug: "container", galleryLimit: 6 }),
  ]);
  const block = result.ok ? result.blocks[1] : null;
  assert.equal(block?.type === "GALLERY" ? block.categorySlug : null, "container");
  assert.equal(block?.type === "GALLERY" ? block.limit : 0, 6);
});

test("a gallery section with no count uses the same default Lane B parses", () => {
  const result = mapCmsSectionsToBlocks([heroSection, section({ id: "g", type: "GALLERY", heading: "ผลงาน" })]);
  const block = result.ok ? result.blocks[1] : null;
  assert.equal(block?.type === "GALLERY" ? block.limit : 0, 12);
});

test("a disabled section is not rendered", () => {
  const result = mapCmsSectionsToBlocks([heroSection, section({ id: "off", enabled: false })]);
  assert.equal(result.ok && result.blocks.length, 1);
});

test("an image reference resolves through the caller, and an unresolvable one is dropped", () => {
  const withImage = section({ ...heroSection, imageItemId: "item-1" });
  const resolved = mapCmsSectionsToBlocks([withImage], { resolveMedia: () => media });
  assert.equal(resolved.ok && resolved.blocks[0].type === "HERO" && resolved.blocks[0].media !== null, true);

  // A missing image is not a reason to lose the copy.
  const unresolved = mapCmsSectionsToBlocks([withImage], { resolveMedia: () => null });
  assert.equal(unresolved.ok, true);
  assert.equal(unresolved.ok && unresolved.blocks[0].type === "HERO" && unresolved.blocks[0].media, null);
});

test("a resolver that returns private media makes the whole page refuse", () => {
  const leaked: PublicMedia = { ...media, variants: [{ src: "/api/m/1.jpg", width: 8, height: 6, format: "jpeg", role: "display" }] };
  const result = mapCmsSectionsToBlocks([section({ ...heroSection, imageItemId: "x" })], { resolveMedia: () => leaked });
  assert.equal(result.ok, false);
});

test("a section type this mapper has never seen is refused rather than rendered as prose", () => {
  const result = mapCmsSectionsToBlocks([heroSection, section({ type: "TESTIMONIAL" })]);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /TESTIMONIAL/);
});

test("the mapper's output passes the render contract unchanged", () => {
  const result = mapCmsSectionsToBlocks([heroSection, section({ id: "c", type: "CONTENT", heading: "เนื้อหา" })]);
  assert.equal(result.ok, true);
  assert.equal(result.ok && validateBlocks(result.blocks).ok, true);
});

test("a page with no hero is refused, because nothing supplies the h1", () => {
  const result = mapCmsSectionsToBlocks([section({ id: "c", type: "CONTENT", heading: "เนื้อหา" })]);
  assert.equal(result.ok, false);
});

test("blocks Lane B cannot express are recorded rather than invented", () => {
  const blocks = BLOCKS_LANE_B_CANNOT_EXPRESS.map((entry) => entry.block);
  assert.deepEqual([...blocks].sort(), ["FEATURED_WORK", "IMAGE", "RELATED_SERVICES", "STATS", "VIDEO"]);
  for (const entry of BLOCKS_LANE_B_CANNOT_EXPRESS) {
    assert.ok(entry.reason.length > 20, `${entry.block} needs a reason worth reading`);
    assert.equal(PUBLIC_BLOCK_TYPES.includes(entry.block), true);
    // And none of them is reachable from any section type.
    assert.equal(Object.values(CMS_SECTION_BLOCK_TYPES).includes(entry.block), false);
  }
});

test("every block type is either mapped from a section or recorded as unmappable", () => {
  // Nothing may fall between the two: a block the renderer supports, no section
  // maps to, and nobody wrote down, is a feature that quietly never arrives.
  const mapped = new Set(Object.values(CMS_SECTION_BLOCK_TYPES));
  const recorded = new Set(BLOCKS_LANE_B_CANNOT_EXPRESS.map((entry) => entry.block));
  for (const type of PUBLIC_BLOCK_TYPES) {
    assert.equal(mapped.has(type) || recorded.has(type), true, `${type} is neither mapped nor recorded`);
  }
});

test("the section types this mapper handles are exactly the ones Lane B defines", async () => {
  // An unrecognised section type makes the whole page fall back to static, so
  // Lane B adding one would take every page containing it off the CMS at once.
  // That is the right failure direction, but it must be caught by a test rather
  // than by a customer looking at a page that reverted to the static copy.
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../lib/site-cms-content.ts", import.meta.url), "utf8"),
  );
  const union = source.match(/export type CmsSectionType =([^;]+);/)?.[1] ?? "";
  const laneB = [...union.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]).sort();
  assert.ok(laneB.length > 0, "could not read Lane B's section types");
  assert.deepEqual(Object.keys(CMS_SECTION_BLOCK_TYPES).sort(), laneB);
});
