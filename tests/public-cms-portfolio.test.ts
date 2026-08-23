import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PUBLIC_CMS_CONTRACT_VERSION, PUBLIC_ROUTE_PATHS, type PublicMedia } from "../lib/public-cms/contract.ts";
import type { PublicBlock } from "../lib/public-cms/blocks.ts";
import {
  FORBIDDEN_PAYLOAD_KEYS,
  WORK_CATEGORY_IDS,
  WORK_INDEX_PATH,
  WORK_PAGE_SIZE,
  buildWorkList,
  buildWorkSitemapUrls,
  compareWorkItems,
  findForbiddenKeys,
  isValidWorkSlug,
  isWorkPath,
  validateWorkItem,
  workBreadcrumb,
  workPath,
  type PublicWorkItem,
} from "../lib/public-cms/portfolio.ts";

const media: PublicMedia = {
  id: "m1",
  altText: "รถบรรทุก 6 ล้อบรรทุกรถจักรยานยนต์",
  caption: null,
  variants: [{ src: "/assets/gallery/a-display.jpg", width: 1600, height: 900, format: "jpeg", role: "display" }],
};

function work(overrides: Partial<PublicWorkItem> = {}): PublicWorkItem {
  const slug = overrides.slug ?? "chiang-mai-fleet-move";
  return {
    contractVersion: PUBLIC_CMS_CONTRACT_VERSION,
    status: "PUBLISHED",
    slug,
    path: workPath(slug),
    title: "ขนย้ายรถจักรยานยนต์ 120 คันไปเชียงใหม่",
    summary: "งานล็อตใหญ่ด้วยรถ 6 ล้อ พร้อมลานพักรถปลายทาง",
    categoryIds: ["large-batch", "truck-6"],
    featured: false,
    order: 10,
    publishedAt: "2026-07-01T00:00:00.000Z",
    featuredImage: media,
    gallery: [media],
    blocks: [{ type: "TEXT", id: "b1", heading: "ขอบเขตงาน", headingLevel: 2, body: ["รายละเอียด"], media: [] }],
    relatedServices: [{ label: "ขนส่งในประเทศ", href: "/motorcycle-transport/" }],
    seo: {
      title: "ขนย้ายรถจักรยานยนต์ 120 คันไปเชียงใหม่ | NATHEE GROUP 2025",
      description: "งานล็อตใหญ่ด้วยรถ 6 ล้อ พร้อมลานพักรถปลายทาง",
      canonicalPath: workPath(slug),
      robots: "INDEX",
    },
    revisionId: "rev-1",
    ...overrides,
  };
}

const accept = (input: unknown) => validateWorkItem(input, PUBLIC_CMS_CONTRACT_VERSION);
const fieldsOf = (input: unknown) => {
  const result = accept(input);
  return result.ok ? [] : result.violations.map((violation) => violation.field);
};

// --- the rule that matters: no customer or job data, ever -------------------

test("a well formed entry is accepted", () => {
  assert.equal(accept(work()).ok, true);
});

test("a payload carrying a copied job row is refused whole", () => {
  // The realistic failure is not someone adding a customerName field to the
  // type — it is `{ ...jobRow, title, summary }` in a mapper, which satisfies
  // the type perfectly and ships the entire row.
  for (const key of FORBIDDEN_PAYLOAD_KEYS) {
    const leaked = { ...work(), [key]: "anything" } as unknown;
    const result = accept(leaked);
    assert.equal(result.ok, false, `${key} must be refused`);
    assert.ok(
      fieldsOf(leaked).some((field) => field.endsWith(`.${key}`)),
      `${key} must be named in the violation`,
    );
  }
});

test("customer data is found however deeply it is buried", () => {
  const nested = {
    ...work(),
    blocks: [
      {
        type: "TEXT",
        id: "b1",
        heading: "ขอบเขตงาน",
        headingLevel: 2,
        body: ["รายละเอียด"],
        media: [],
        // Somebody attached the source record to the block they built from it.
        provenance: { job: { jobNumber: "JOB-2026-000123", vin: "MH1JA1234NK000001" } },
      },
    ],
  };
  const violations = fieldsOf(nested);
  assert.ok(violations.some((field) => field.includes("jobNumber")), "jobNumber must be found");
  assert.ok(violations.some((field) => field.includes("vin")), "vin must be found");
});

test("the forbidden keys are real column names, not guesses", async () => {
  // A list of invented names would drift away from the schema and stop
  // catching anything. Every entry has to exist in the database it protects.
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  const missing = FORBIDDEN_PAYLOAD_KEYS.filter((key) => !schema.includes(`"${snake(key)}"`));
  // A few are defensive names for shapes an API could produce rather than
  // columns; the great majority must be real.
  assert.ok(
    missing.length <= 4,
    `these forbidden keys do not correspond to any column: ${missing.join(", ")}`,
  );
  for (const key of ["vin", "registration", "jobNumber", "storageKey", "contactPhone", "podId"]) {
    assert.ok(FORBIDDEN_PAYLOAD_KEYS.includes(key), `${key} must be refused`);
  }
});

test("a legitimate entry is not refused for containing ordinary words", () => {
  // The check is on keys, not on prose: a summary may talk about a route or a
  // note without tripping it.
  const wordy = work({
    summary: "งานจากจังหวัดหนึ่งไปอีกจังหวัด พร้อมบันทึกภาพ",
    blocks: [{ type: "TEXT", id: "b", heading: "หมายเหตุการทำงาน", headingLevel: 2, body: ["province note phone"], media: [] }],
  });
  assert.equal(accept(wordy).ok, true);
});

test("a payload too deep or too wide to verify is refused, not passed", () => {
  // "Too deep to check" is not the same as "checked and clean".
  let deep: Record<string, unknown> = { vin: "hidden" };
  for (let index = 0; index < 12; index += 1) deep = { nested: deep };
  assert.ok(findForbiddenKeys(deep).length > 0);

  const wide = Array.from({ length: 501 }, () => ({ safe: true }));
  assert.ok(findForbiddenKeys(wide).length > 0);
});

test("a clean payload produces no findings", () => {
  assert.deepEqual(findForbiddenKeys(work()), []);
  assert.deepEqual(findForbiddenKeys(null), []);
  assert.deepEqual(findForbiddenKeys("a string"), []);
});

// --- publication state --------------------------------------------------------

test("nothing but PUBLISHED renders", () => {
  for (const status of ["DRAFT", "HIDDEN", "ARCHIVED", "", null]) {
    assert.equal(accept({ ...work(), status }).ok, false, `${String(status)} must be refused`);
  }
});

test("a payload from another contract version is refused whole", () => {
  assert.ok(fieldsOf({ ...work(), contractVersion: PUBLIC_CMS_CONTRACT_VERSION + 1 }).includes("contractVersion"));
});

// --- identity -----------------------------------------------------------------

test("slugs are latin, lowercase and not reserved", () => {
  for (const slug of ["chiang-mai-move", "q3-2026", "a"]) assert.equal(isValidWorkSlug(slug), true, slug);
  for (const slug of ["", "Chiang-Mai", "a--b", "-x", "x-", "ขนส่ง", "page", "index", "a".repeat(81)]) {
    assert.equal(isValidWorkSlug(slug), false, slug);
  }
});

test("the path is derived from the slug and cannot take a marketing route", () => {
  assert.equal(workPath("a-move"), "/work/a-move/");
  assert.ok(fieldsOf(work({ slug: "a-move", path: "/work/other/" })).includes("path"));
  assert.ok(fieldsOf(work({ slug: "a-move", path: "/work/a-move" })).includes("path"));
  for (const route of PUBLIC_ROUTE_PATHS) {
    assert.equal(accept(work({ slug: "about", path: route })).ok, false, `${route} must stay a marketing route`);
  }
});

test("work paths are recognised strictly", () => {
  assert.equal(isWorkPath(WORK_INDEX_PATH), true);
  assert.equal(isWorkPath("/work/a-move/"), true);
  assert.equal(isWorkPath("/work/a-move"), false);
  assert.equal(isWorkPath("/work/a/b/"), false);
  assert.equal(isWorkPath("/workshop/"), false);
});

// --- the fields a portfolio needs ---------------------------------------------

test("a photograph is required, because a card without one is a headline in a box", () => {
  assert.ok(fieldsOf({ ...work(), featuredImage: null }).some((field) => field.startsWith("featuredImage")));
  assert.ok(fieldsOf(work({ featuredImage: { ...media, altText: "" } })).includes("featuredImage.altText"));
});

test("a private media path is refused on the featured image and in the gallery", () => {
  const leaked: PublicMedia = { ...media, variants: [{ src: "/api/motorcycles/1/photo.jpg", width: 8, height: 6, format: "jpeg", role: "display" }] };
  assert.equal(accept(work({ featuredImage: leaked })).ok, false);
  assert.equal(accept(work({ gallery: [leaked] })).ok, false);
});

test("an entry must be findable by at least one filter", () => {
  assert.ok(fieldsOf(work({ categoryIds: [] })).includes("categoryIds"));
  assert.ok(fieldsOf(work({ categoryIds: ["not-a-category"] as never })).includes("categoryIds[0]"));
  assert.ok(fieldsOf(work({ categoryIds: ["storage", "storage"] as never })).includes("categoryIds"));
  assert.ok(fieldsOf(work({ categoryIds: ["domestic", "storage", "container", "delivery", "truck-4"] as never })).includes("categoryIds"));
});

test("the work categories are the gallery's, not a second taxonomy", async () => {
  // One vocabulary means a photograph and the case study it belongs to filter
  // the same way.
  const manifest = JSON.parse(await readFile(new URL("../public-site/assets/gallery.json", import.meta.url), "utf8"));
  const galleryIds = manifest.categories.map((category: { id: string }) => category.id).sort();
  assert.deepEqual([...WORK_CATEGORY_IDS].sort(), galleryIds);
});

test("the body carries no hero, because the title is the heading", () => {
  const withHero = work({
    blocks: [{ type: "HERO", id: "h", eyebrow: null, heading: "ซ้ำ", body: [], media: null, actions: [] } as PublicBlock],
  });
  assert.ok(fieldsOf(withHero).includes("blocks"));
});

test("the body is validated as blocks, so a bad block refuses the entry", () => {
  const bad = work({ blocks: [{ type: "CTA", id: "c", heading: "", body: [], actions: [] } as unknown as PublicBlock] });
  assert.equal(accept(bad).ok, false);
});

test("related services must lead to live public routes", () => {
  assert.equal(accept(work({ relatedServices: [] })).ok, true, "naming none is allowed");
  assert.ok(fieldsOf(work({ relatedServices: [{ label: "ระบบ", href: "/app/jobs" }] })).includes("relatedServices[0].href"));
  assert.ok(fieldsOf(work({ relatedServices: [{ label: "", href: "/storage/" }] })).includes("relatedServices[0].label"));
});

test("the canonical is the entry's own path", () => {
  assert.ok(fieldsOf(work({ seo: { ...work().seo, canonicalPath: "/work/elsewhere/" } })).includes("seo.canonicalPath"));
});

// --- the index ----------------------------------------------------------------

const item = (slug: string, over: Partial<PublicWorkItem> = {}) =>
  work({ slug, path: workPath(slug), seo: { ...work().seo, canonicalPath: workPath(slug) }, ...over });

test("featured work leads, then the editor's order", () => {
  const list = buildWorkList([
    item("c", { featured: false, order: 1 }),
    item("a", { featured: true, order: 50 }),
    item("b", { featured: false, order: 0 }),
  ]);
  assert.deepEqual(list.ok && list.items.map((entry) => entry.slug), ["a", "b", "c"]);
});

test("entries the Owner has not ordered still fall in a stable sequence", () => {
  const same = { featured: false, order: 0, publishedAt: "2026-01-01T00:00:00.000Z" };
  const forwards = buildWorkList([item("z", same), item("a", same), item("m", same)]);
  const backwards = buildWorkList([item("m", same), item("a", same), item("z", same)]);
  assert.deepEqual(
    forwards.ok && forwards.items.map((entry) => entry.slug),
    backwards.ok && backwards.items.map((entry) => entry.slug),
  );
  assert.ok(compareWorkItems(item("a", same), item("b", same)) < 0);
});

test("newer work leads older work at the same order", () => {
  const list = buildWorkList([
    item("older", { order: 5, publishedAt: "2026-01-01T00:00:00.000Z" }),
    item("newer", { order: 5, publishedAt: "2026-06-01T00:00:00.000Z" }),
  ]);
  assert.deepEqual(list.ok && list.items.map((entry) => entry.slug), ["newer", "older"]);
});

test("filtering is exact and only offers categories that have work", () => {
  const list = buildWorkList([item("a", { categoryIds: ["storage"] }), item("b", { categoryIds: ["container"] })]);
  assert.equal(list.ok && list.filters.length, 2);
  assert.equal(list.ok && list.filters.every((filter) => filter.count > 0), true);

  const storage = buildWorkList([item("a", { categoryIds: ["storage"] })], { category: "storage" });
  assert.deepEqual(storage.ok && storage.items.map((entry) => entry.slug), ["a"]);
  assert.equal(storage.ok && storage.filters.find((filter) => filter.id === "storage")?.active, true);
});

test("an entry in two categories is counted in both", () => {
  const list = buildWorkList([item("a", { categoryIds: ["storage", "container"] })]);
  assert.equal(list.ok && list.filters.find((filter) => filter.id === "storage")?.count, 1);
  assert.equal(list.ok && list.filters.find((filter) => filter.id === "container")?.count, 1);
});

test("an empty category or a page past the end is a refusal, not an empty grid", () => {
  const items = [item("a")];
  assert.equal(buildWorkList(items, { category: "delivery" }).ok, false);
  assert.equal(buildWorkList(items, { page: 2 }).ok, false);
  assert.equal(buildWorkList(items, { page: 0 }).ok, false);
  assert.equal(buildWorkList(items, { pageSize: 0 }).ok, false);
  assert.equal(buildWorkList([], { page: 1 }).ok, true, "an empty portfolio still has a first page");
});

test("pagination covers every entry exactly once", () => {
  const items = Array.from({ length: WORK_PAGE_SIZE * 2 + 3 }, (_, index) =>
    item(`w-${String(index).padStart(2, "0")}`, { order: index }),
  );
  const seen: string[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const result = buildWorkList(items, { page });
    assert.equal(result.ok, true);
    if (result.ok) seen.push(...result.items.map((entry) => entry.slug));
  }
  assert.equal(new Set(seen).size, items.length);
});

// --- sitemap and breadcrumb ---------------------------------------------------

test("the sitemap lists published indexable work and the index above it", () => {
  const urls = buildWorkSitemapUrls([
    { state: "PUBLISHED", work: item("a") },
    { state: "PUBLISHED", work: item("b") },
    { state: "UNPUBLISHED" },
  ]);
  assert.deepEqual(urls, [
    "https://natheegroup2025.com/work/",
    "https://natheegroup2025.com/work/a/",
    "https://natheegroup2025.com/work/b/",
  ]);
});

test("a noindex entry is served but kept out of the sitemap", () => {
  const hidden = item("hidden");
  const urls = buildWorkSitemapUrls([
    { state: "PUBLISHED", work: { ...hidden, seo: { ...hidden.seo, robots: "NOINDEX" } } },
  ]);
  assert.deepEqual(urls, [], "and an empty section is not advertised either");
});

test("the breadcrumb runs home, portfolio, entry", () => {
  const trail = workBreadcrumb(item("a-move"));
  assert.deepEqual(trail.map((entry) => entry.item), [
    "https://natheegroup2025.com/",
    "https://natheegroup2025.com/work/",
    "https://natheegroup2025.com/work/a-move/",
  ]);
  assert.equal(trail[1].name, "ผลงาน");
});

// --- publishing and SEO, wired into the contracts that already exist --------

test("publishing work refreshes the entry, the index and the sitemap", async () => {
  const { planInvalidation, requiresPublicDeployment, wasRejected } = await import("../lib/public-cms/revalidation.ts");

  const published = planInvalidation({ kind: "WORK_PUBLISHED", path: workPath("a-move"), revisionId: "r" });
  assert.equal(published.delivery, "CACHE");
  assert.deepEqual(published.paths, ["/work/", "/work/a-move/"]);
  assert.equal(published.regenerateSitemap, true);
  assert.equal(requiresPublicDeployment({ kind: "WORK_PUBLISHED", path: workPath("a-move"), revisionId: "r" }), false);

  const withdrawn = planInvalidation({ kind: "WORK_UNPUBLISHED", path: workPath("a-move") });
  assert.deepEqual(withdrawn.removedPaths, ["/work/a-move/"]);
  assert.equal(withdrawn.paths.includes("/sitemap.xml"), true);

  const moved = planInvalidation({ kind: "WORK_MOVED", from: workPath("old"), to: workPath("new") });
  assert.equal(moved.paths.includes("/work/old/"), true);
  assert.equal(moved.paths.includes("/work/new/"), true);
  // The old URL must answer with a 301 rather than a 404, or the inbound links
  // to it are thrown away.
  assert.deepEqual(moved.removedPaths, []);

  for (const event of [
    { kind: "WORK_PUBLISHED" as const, path: "/about/", revisionId: "r" },
    { kind: "WORK_PUBLISHED" as const, path: WORK_INDEX_PATH, revisionId: "r" },
    { kind: "WORK_MOVED" as const, from: workPath("a"), to: workPath("a") },
    { kind: "WORK_MOVED" as const, from: workPath("a"), to: "/news/b/" },
  ]) {
    const plan = planInvalidation(event);
    assert.equal(plan.delivery, "REJECTED", `${JSON.stringify(event)} must be refused`);
    assert.deepEqual(plan.paths, []);
    assert.equal(wasRejected(event), true);
  }
});

test("a portfolio entry appears in the one sitemap alongside pages and posts", async () => {
  const { buildSitemap } = await import("../lib/public-cms/seo.ts");
  const entries = buildSitemap([], [], [{ state: "PUBLISHED", work: item("a-move") }]);
  assert.deepEqual(entries.map((entry) => entry.url), [
    "https://natheegroup2025.com/work/",
    "https://natheegroup2025.com/work/a-move/",
  ]);
  assert.equal(entries[1].lastModified, "2026-07-01T00:00:00.000Z");
  // The index changed when its newest entry did.
  assert.equal(entries[0].lastModified, "2026-07-01T00:00:00.000Z");
});

test("the head describes the entry as work, with the same image and breadcrumb rules", async () => {
  const { buildWorkHead } = await import("../lib/public-cms/seo.ts");
  const head = buildWorkHead({ state: "PUBLISHED", work: item("a-move") });
  assert.equal(head.httpStatus, 200);
  assert.equal(head.canonical, "https://natheegroup2025.com/work/a-move/");
  assert.equal(head.robots, "index, follow");
  assert.equal(head.openGraph["og:image"], "https://natheegroup2025.com/assets/gallery/a-display.jpg");

  const graph = head.jsonLd[0]["@graph"] as Array<Record<string, unknown>>;
  const creative = graph.find((node) => node["@type"] === "CreativeWork");
  assert.ok(creative);
  assert.equal(creative?.datePublished, "2026-07-01T00:00:00.000Z");
  assert.deepEqual(creative?.provider, { "@id": "https://natheegroup2025.com/#organization" });
  const trail = graph.find((node) => node["@type"] === "BreadcrumbList")?.itemListElement as Array<Record<string, unknown>>;
  assert.equal(trail.length, 3);
});

test("an unpublished entry is a 404 and a preview emits no social tags", async () => {
  const { buildWorkHead } = await import("../lib/public-cms/seo.ts");
  assert.equal(buildWorkHead({ state: "UNPUBLISHED" }).httpStatus, 404);
  assert.equal(buildWorkHead({ state: "MOVED", to: workPath("new") }).httpStatus, 301);

  const preview = buildWorkHead({ state: "PUBLISHED", work: item("a-move") }, { isPreview: true });
  assert.deepEqual(preview.openGraph, {}, "a preview link pasted into chat must not unfurl unpublished work");
  assert.deepEqual(preview.jsonLd, []);
  assert.equal(preview.includeInSitemap, false);
  assert.equal(preview.canonical, "https://natheegroup2025.com/work/a-move/");
});
