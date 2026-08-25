import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { validateMediaSrc } from "../lib/public-cms/contract.ts";
import { buildMediaRenderModel } from "../lib/public-cms/media.ts";
import { DEFAULT_SITE_SETTINGS, parseSiteSettings } from "../lib/site-settings-content.ts";
import { resolveSettingsMedia } from "../lib/site-settings-media.ts";
import { d1Over, migratedSqlite } from "./support/d1-over-sqlite.mjs";

// The LINE QR is the one piece of media on the contact page a visitor is told
// to scan, and it is chosen from the same library that holds customers' job
// evidence. So the interesting cases are all the ones where the id names
// something that must never reach a public page.

const QR = "11111111-1111-4111-8111-111111111111";
const LOGO = "22222222-2222-4222-8222-222222222222";

function setup() {
  const sqlite = migratedSqlite();
  sqlite.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('user-owner', 'auth-owner', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO user_role_assignments (user_id, role, assigned_by)
    VALUES ('user-owner', 'OWNER', 'user-owner');
    INSERT INTO companies (id, code, legal_name, display_name)
    VALUES ('company-a', 'CUS-A', 'Company A Limited', 'Company A');
    INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by)
    VALUES ('job-1', 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'JOB-2026-000001', 'company-a', 'Bangkok', 'Chiang Mai', 'OPEN', 'user-owner');
    INSERT INTO gallery_categories (id, slug, name, created_by)
    VALUES ('cat-1', 'contact', 'Contact', 'user-owner');
  `);
  return { sqlite, db: drizzle(d1Over(sqlite)) };
}

let counter = 0;
function addItem(sqlite, { id, status = "PUBLISHED", visibility = "PUBLIC", variants = FULL, companyId = null, jobId = null }) {
  counter += 1;
  const published = status === "PUBLISHED" ? "'user-owner', '2026-08-25 00:00:00'" : "NULL, NULL";
  sqlite.exec(
    `INSERT INTO gallery_items (id, request_key, category_id, company_id, job_id, title, caption, alt_text, status, visibility, sort_order, uploaded_by, published_by, published_at)
     VALUES ('${id}', 'rk-${counter}', 'cat-1', ${companyId ? `'${companyId}'` : "NULL"}, ${jobId ? `'${jobId}'` : "NULL"},
             'LINE QR', NULL, 'QR Code LINE for contacting NATHEE GROUP', '${status}', '${visibility}', 0, 'user-owner', ${published})`,
  );
  variants.forEach((variant, index) => {
    sqlite.exec(
      `INSERT INTO gallery_image_variants (id, gallery_item_id, role, storage_key, content_type, width, height, byte_size, checksum)
       VALUES ('${id}-v${index}', '${id}', '${variant.role}', 'gallery/${id}/${variant.role.toLowerCase()}-${index}.bin',
               '${variant.contentType}', ${variant.width}, ${variant.height}, 2048, '${"a".repeat(64)}')`,
    );
  });
}

const FULL = [
  { role: "ORIGINAL", contentType: "image/png", width: 1800, height: 1800 },
  { role: "DISPLAY", contentType: "image/png", width: 900, height: 900 },
  { role: "DISPLAY", contentType: "image/webp", width: 900, height: 900 },
  { role: "THUMBNAIL", contentType: "image/png", width: 320, height: 320 },
];

function settingsWith(patch) {
  const parsed = parseSiteSettings({
    ...DEFAULT_SITE_SETTINGS,
    brand: { ...DEFAULT_SITE_SETTINGS.brand, ...(patch.brand ?? {}) },
    contact: { ...DEFAULT_SITE_SETTINGS.contact, ...(patch.contact ?? {}) },
  });
  assert.ok(parsed, "the test settings were refused by the parser");
  return parsed;
}

test("a published public QR resolves to the canonical delivery path", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, { id: QR });

  const media = await resolveSettingsMedia(db, settingsWith({ contact: { lineQrItemId: QR } }));
  assert.ok(media.lineQr, "the QR did not resolve");
  assert.deepEqual(media.unresolvable, []);

  for (const variant of media.lineQr.variants) {
    // The one contract: /assets/media/..., never /api/gallery/images/...
    assert.deepEqual(validateMediaSrc(variant.src, "src"), [], `${variant.src} is not a public source`);
    assert.match(variant.src, /^\/assets\/media\//);
    assert.equal(variant.src.includes("/api/"), false);
    // No storage key ever leaves the server.
    assert.equal(variant.src.includes("gallery/"), false, `${variant.src} leaks the storage layout`);
  }
  // The untouched original is stored and is not offered.
  assert.equal(media.lineQr.variants.some((variant) => variant.src.includes("original")), false);
  sqlite.close();
});

// A QR that cannot be decoded is worse than an absent one, because a visitor
// will try to scan it.
test("a resolved QR renders, with a raster fallback every client can decode", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, { id: QR });
  const media = await resolveSettingsMedia(db, settingsWith({ contact: { lineQrItemId: QR } }));
  const rendered = buildMediaRenderModel(media.lineQr);
  assert.equal(rendered.ok, true, rendered.ok ? "" : rendered.reason);
  if (!rendered.ok) return;
  assert.match(rendered.model.img.src, /\.(jpg|png)$/);
  assert.equal(rendered.model.img.alt.length > 0, true);
  sqlite.close();
});

// Each of these is a real row in the same library the picker reads from.
test("private, customer and unpublished media can never become the public QR", async () => {
  const cases = [
    ["draft", { status: "DRAFT", visibility: "PUBLIC" }],
    ["hidden", { status: "HIDDEN", visibility: "PUBLIC" }],
    ["archived", { status: "ARCHIVED", visibility: "PUBLIC" }],
    ["internal", { status: "PUBLISHED", visibility: "INTERNAL" }],
    ["customer job", { status: "PUBLISHED", visibility: "CUSTOMER_JOB", companyId: "company-a", jobId: "job-1" }],
  ];

  for (const [label, options] of cases) {
    const { sqlite, db } = setup();
    addItem(sqlite, { id: QR, ...options });
    const media = await resolveSettingsMedia(db, settingsWith({ contact: { lineQrItemId: QR } }));
    assert.equal(media.lineQr, null, `${label} media resolved as the public QR`);
    assert.deepEqual(
      media.unresolvable,
      [{ id: QR, reason: "not a published public gallery item" }],
      `${label} was not reported`,
    );
    sqlite.close();
  }
});

test("a QR with no raster fallback is refused rather than rendered as a blank", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, {
    id: QR,
    variants: [
      { role: "DISPLAY", contentType: "image/webp", width: 900, height: 900 },
      { role: "DISPLAY", contentType: "image/avif", width: 900, height: 900 },
    ],
  });
  const media = await resolveSettingsMedia(db, settingsWith({ contact: { lineQrItemId: QR } }));
  assert.equal(media.lineQr, null);
  assert.deepEqual(media.unresolvable, [{ id: QR, reason: "no jpeg or png display variant to fall back to" }]);
  sqlite.close();
});

test("the logo and the QR resolve independently, in one read", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, { id: QR });
  addItem(sqlite, { id: LOGO, status: "HIDDEN" });

  const media = await resolveSettingsMedia(db, settingsWith({ brand: { logoItemId: LOGO }, contact: { lineQrItemId: QR } }));
  assert.ok(media.lineQr, "the public QR did not resolve");
  assert.equal(media.logo, null, "a hidden logo resolved");
  assert.deepEqual(media.unresolvable.map((entry) => entry.id), [LOGO]);
  sqlite.close();
});

test("settings that name no media ask the database for nothing", async () => {
  const { sqlite, db } = setup();
  const media = await resolveSettingsMedia(db, settingsWith({}));
  assert.deepEqual(media, { logo: null, lineQr: null, unresolvable: [] });
  sqlite.close();
});
