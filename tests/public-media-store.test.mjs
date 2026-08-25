import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { buildMediaRenderModel } from "../lib/public-cms/media.ts";
import { resolvePublicMedia, createPublicMediaResolver, MAX_RESOLVABLE_MEDIA_IDS } from "../lib/public-media-store.ts";
import { mapStoredPostToPublicPost } from "../lib/post-cms-public.ts";
import { d1Over, migratedSqlite } from "./support/d1-over-sqlite.mjs";

// The media resolver decides what a visitor is shown, so it is proven against
// real rows under the real constraints rather than against a stub. Every case
// below is one a marketing site actually produces: a draft photograph, a
// customer's job evidence mislabelled, an internal snapshot, an upload that
// only ever got a WebP.

const PUBLIC_ITEM = "11111111-1111-4111-8111-111111111111";

function setup() {
  const sqlite = migratedSqlite();
  sqlite.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('user-owner', 'auth-owner', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO user_role_assignments (user_id, role, assigned_by)
    VALUES ('user-owner', 'OWNER', 'user-owner');
    INSERT INTO companies (id, code, legal_name, display_name) VALUES ('company-a', 'CUS-A', 'Company A Limited', 'Company A');
    INSERT INTO gallery_categories (id, slug, name, created_by)
    VALUES ('cat-1', 'truck-loading', 'Truck loading', 'user-owner');
  `);
  return { sqlite, db: drizzle(d1Over(sqlite)) };
}

let itemCounter = 0;

function addItem(sqlite, { id, status = "PUBLISHED", visibility = "PUBLIC", variants, companyId = null, jobId = null }) {
  itemCounter += 1;
  const published = status === "PUBLISHED" ? "'user-owner', '2026-08-25 00:00:00'" : "NULL, NULL";
  sqlite.exec(
    `INSERT INTO gallery_items (id, request_key, category_id, company_id, job_id, title, caption, alt_text, status, visibility, sort_order, uploaded_by, published_by, published_at)
     VALUES ('${id}', 'rk-${itemCounter}', 'cat-1', ${companyId ? `'${companyId}'` : "NULL"}, ${jobId ? `'${jobId}'` : "NULL"},
             'Loading motorcycles', 'On site', 'Motorcycles being loaded onto a truck', '${status}', '${visibility}', 0, 'user-owner', ${published})`,
  );
  variants.forEach((variant, index) => {
    sqlite.exec(
      `INSERT INTO gallery_image_variants (id, gallery_item_id, role, storage_key, content_type, width, height, byte_size, checksum)
       VALUES ('${id}-v${index}', '${id}', '${variant.role}', 'gallery/${id}/${variant.role.toLowerCase()}-${index}.bin',
               '${variant.contentType}', ${variant.width ?? "NULL"}, ${variant.height ?? "NULL"}, 1024, '${"a".repeat(64)}')`,
    );
  });
}

const FULL_VARIANTS = [
  { role: "ORIGINAL", contentType: "image/jpeg", width: 4000, height: 3000 },
  { role: "DISPLAY", contentType: "image/jpeg", width: 1600, height: 900 },
  { role: "DISPLAY", contentType: "image/webp", width: 1600, height: 900 },
  { role: "DISPLAY", contentType: "image/avif", width: 1600, height: 900 },
  { role: "THUMBNAIL", contentType: "image/jpeg", width: 640, height: 360 },
  { role: "THUMBNAIL", contentType: "image/webp", width: 640, height: 360 },
];

test("a published public item resolves to media the public contract accepts", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, { id: PUBLIC_ITEM, variants: FULL_VARIANTS });

  const resolution = await resolvePublicMedia(db, [PUBLIC_ITEM]);
  assert.deepEqual(resolution.unresolvable, []);
  const media = resolution.media.get(PUBLIC_ITEM);
  assert.ok(media, "the item did not resolve");

  // Every source is a public asset path. Not one storage key escapes.
  for (const variant of media.variants) {
    assert.match(variant.src, /^\/assets\/media\//);
    assert.equal(variant.src.includes("gallery/"), false, `${variant.src} leaks the storage layout`);
  }
  // The untouched original is stored and is not offered.
  assert.equal(media.variants.length, 5);
  assert.equal(media.variants.some((variant) => variant.src.includes("original")), false);
  sqlite.close();
});

test("resolved media renders, rather than merely validating", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, { id: PUBLIC_ITEM, variants: FULL_VARIANTS });
  const resolution = await resolvePublicMedia(db, [PUBLIC_ITEM]);
  const rendered = buildMediaRenderModel(resolution.media.get(PUBLIC_ITEM));
  assert.equal(rendered.ok, true, rendered.ok ? "" : rendered.reason);
  if (!rendered.ok) return;
  assert.match(rendered.model.img.src, /\/assets\/media\/.*\.(jpg|png)$/);
  assert.equal(rendered.model.img.width, 1600);
  assert.equal(rendered.model.img.height, 900);
  sqlite.close();
});

// Each of these is a photograph that exists and must not be published.
test("everything that is not published and public resolves to nothing", async () => {
  const { sqlite, db } = setup();
  sqlite.exec(
    `INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by)
     VALUES ('job-1', 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'JOB-2026-000001', 'company-a', 'Bangkok', 'Chiang Mai', 'OPEN', 'user-owner')`,
  );
  const cases = [
    ["draft", { status: "DRAFT", visibility: "PUBLIC" }],
    ["hidden", { status: "HIDDEN", visibility: "PUBLIC" }],
    ["archived", { status: "ARCHIVED", visibility: "PUBLIC" }],
    ["internal", { status: "PUBLISHED", visibility: "INTERNAL" }],
    ["customer", { status: "PUBLISHED", visibility: "CUSTOMER_JOB", companyId: "company-a", jobId: "job-1" }],
  ];
  const ids = [];
  for (const [label, options] of cases) {
    const id = `2222${label.padEnd(4, "0").slice(0, 4)}-1111-4111-8111-111111111111`;
    ids.push(id);
    addItem(sqlite, { id, variants: FULL_VARIANTS, ...options });
  }

  const resolution = await resolvePublicMedia(db, ids);
  assert.equal(resolution.media.size, 0, "a non-public photograph resolved");
  assert.equal(resolution.unresolvable.length, ids.length);
  for (const entry of resolution.unresolvable) {
    assert.equal(entry.reason, "not a published public gallery item");
  }
  sqlite.close();
});

// The defect this found in the existing pipeline: the browser uploader stored
// WebP and AVIF only, so managed media had no fallback the public renderer
// would accept and would have rendered as an empty box.
test("an item with no jpeg or png display variant is refused, with the reason", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, {
    id: PUBLIC_ITEM,
    variants: [
      { role: "ORIGINAL", contentType: "image/jpeg", width: 4000, height: 3000 },
      { role: "DISPLAY", contentType: "image/webp", width: 1600, height: 900 },
      { role: "DISPLAY", contentType: "image/avif", width: 1600, height: 900 },
    ],
  });
  const resolution = await resolvePublicMedia(db, [PUBLIC_ITEM]);
  assert.equal(resolution.media.size, 0);
  assert.deepEqual(resolution.unresolvable, [
    { id: PUBLIC_ITEM, reason: "no jpeg or png display variant to fall back to" },
  ]);
  sqlite.close();
});

test("a variant with no measured dimensions is dropped rather than guessed", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, {
    id: PUBLIC_ITEM,
    variants: [
      { role: "DISPLAY", contentType: "image/jpeg", width: 1600, height: 900 },
      { role: "DISPLAY", contentType: "image/webp", width: null, height: null },
    ],
  });
  const resolution = await resolvePublicMedia(db, [PUBLIC_ITEM]);
  const media = resolution.media.get(PUBLIC_ITEM);
  assert.ok(media);
  assert.deepEqual(media.variants.map((variant) => variant.format), ["jpeg"]);
  sqlite.close();
});

// HEIC is accepted on upload because a phone produces it, and no browser is
// required to decode it.
test("a heic variant is stored and never served", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, {
    id: PUBLIC_ITEM,
    variants: [
      { role: "DISPLAY", contentType: "image/jpeg", width: 1600, height: 900 },
      { role: "DISPLAY", contentType: "image/heic", width: 1600, height: 900 },
    ],
  });
  const resolution = await resolvePublicMedia(db, [PUBLIC_ITEM]);
  assert.deepEqual(
    resolution.media.get(PUBLIC_ITEM).variants.map((variant) => variant.format),
    ["jpeg"],
  );
  sqlite.close();
});

test("an unknown id is reported rather than silently missing", async () => {
  const { sqlite, db } = setup();
  const resolution = await resolvePublicMedia(db, ["33333333-3333-4333-8333-333333333333"]);
  assert.equal(resolution.media.size, 0);
  assert.equal(resolution.unresolvable.length, 1);
  sqlite.close();
});

test("more references than a revision may carry are refused, not truncated", async () => {
  const { sqlite, db } = setup();
  const ids = Array.from({ length: MAX_RESOLVABLE_MEDIA_IDS + 1 }, (_, index) =>
    `4444${String(index).padStart(4, "0")}-4444-4444-8444-444444444444`,
  );
  const resolution = await resolvePublicMedia(db, ids);
  assert.equal(resolution.media.size, 0);
  assert.equal(resolution.unresolvable.length, ids.length);
  assert.match(resolution.unresolvable[0].reason, /too many media references/);
  sqlite.close();
});

// The end of the chain the contract was written for: stored gallery row ->
// resolver -> post mapper -> Lane A's own validator.
test("a stored post maps to a public post whose images come from real rows", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, { id: PUBLIC_ITEM, variants: FULL_VARIANTS });
  const resolution = await resolvePublicMedia(db, [PUBLIC_ITEM]);

  const stored = {
    slug: "first-post",
    revisionId: "rev-1",
    publishedAt: "2026-08-25T00:00:00.000Z",
    updatedAt: null,
    content: {
      version: 1,
      title: "ขนส่งรถจักรยานยนต์",
      excerpt: "สรุปงานขนส่งรถจักรยานยนต์ล็อตใหญ่ประจำเดือน",
      category: { id: "news", label: "ข่าวสาร" },
      featuredImageItemId: PUBLIC_ITEM,
      seo: { title: "ขนส่งรถจักรยานยนต์", description: "สรุปงานขนส่งล็อตใหญ่", robots: "INDEX" },
      sections: [
        { id: "s1", enabled: true, heading: "รายละเอียด", body: "ขนส่งรถจักรยานยนต์ 120 คัน", imageItemId: PUBLIC_ITEM, items: [] },
      ],
    },
  };

  const result = mapStoredPostToPublicPost(stored, createPublicMediaResolver(resolution));
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.violations));
  if (!result.ok) return;
  assert.equal(result.post.featuredImage.id, PUBLIC_ITEM);
  assert.match(result.post.featuredImage.variants[0].src, /^\/assets\/media\//);
  assert.equal(result.post.sections[0].media.length, 1);
  sqlite.close();
});

// An image withdrawn after publication must vanish from the payload rather than
// render as a broken picture.
test("a post whose image was withdrawn maps without it rather than failing", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, { id: PUBLIC_ITEM, status: "HIDDEN", variants: FULL_VARIANTS });
  const resolution = await resolvePublicMedia(db, [PUBLIC_ITEM]);

  const stored = {
    slug: "first-post",
    revisionId: "rev-1",
    publishedAt: "2026-08-25T00:00:00.000Z",
    updatedAt: null,
    content: {
      version: 1,
      title: "ขนส่งรถจักรยานยนต์",
      excerpt: "สรุปงานขนส่งรถจักรยานยนต์ล็อตใหญ่ประจำเดือน",
      category: { id: "news", label: "ข่าวสาร" },
      featuredImageItemId: PUBLIC_ITEM,
      seo: { title: "ขนส่งรถจักรยานยนต์", description: "สรุปงานขนส่งล็อตใหญ่", robots: "INDEX" },
      sections: [
        { id: "s1", enabled: true, heading: "รายละเอียด", body: "ขนส่งรถจักรยานยนต์ 120 คัน", imageItemId: PUBLIC_ITEM, items: [] },
      ],
    },
  };

  const result = mapStoredPostToPublicPost(stored, createPublicMediaResolver(resolution));
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.violations));
  if (!result.ok) return;
  assert.equal(result.post.featuredImage, null);
  assert.deepEqual(result.post.sections[0].media, []);
  sqlite.close();
});
