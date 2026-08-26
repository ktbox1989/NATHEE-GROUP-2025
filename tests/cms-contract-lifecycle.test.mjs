import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import {
  auditLogs,
  sitePagePublicationEvents,
  sitePageRevisions,
  sitePages,
  siteSettingsPublicationEvents,
  siteSettingsRevisions,
} from "../db/schema.ts";
import { getPublishedSitePage } from "../lib/site-cms.ts";
import { DEFAULT_SITE_CONTENT, parseCmsPageContent, serializeCmsPageContent } from "../lib/site-cms-content.ts";
import { getPublishedSiteSettings } from "../lib/site-settings.ts";
import { DEFAULT_SITE_SETTINGS, parseSiteSettings, serializeSiteSettings } from "../lib/site-settings-content.ts";
import { d1Over, migratedSqlite } from "./support/d1-over-sqlite.mjs";

// A field that survives `parseX` and dies somewhere between the editor and the
// public reader is worse than an absent one: the Owner sees it saved and the
// visitor never sees it. So both new contracts are carried the whole way -
// draft, publish, a second draft that must not go live, and a revert - against
// a real migrated database through the code the routes call.

const HASH = "c".repeat(64);

function setup() {
  const sqlite = migratedSqlite();
  sqlite.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('user-owner', 'auth-owner', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO user_role_assignments (user_id, role, assigned_by)
    VALUES ('user-owner', 'OWNER', 'user-owner');
  `);
  return { sqlite, db: drizzle(d1Over(sqlite)) };
}

let tick = 0;
/** Distinct one-second stamps, the resolution the timestamp contract uses. */
function at() {
  tick += 1;
  return `2026-08-25 11:${String(Math.floor(tick / 60)).padStart(2, "0")}:${String(tick % 60).padStart(2, "0")}`;
}

// --- site settings ----------------------------------------------------------

function settingsWith(patch) {
  const parsed = parseSiteSettings({
    ...DEFAULT_SITE_SETTINGS,
    contact: { ...DEFAULT_SITE_SETTINGS.contact, ...patch },
  });
  assert.ok(parsed, "the test settings were refused by the parser");
  return parsed;
}

async function saveSettings(db, key, settings) {
  await db.insert(siteSettingsRevisions).values({
    id: `set-rev-${key}`,
    requestKey: `set-save-${key}`,
    settingsJson: serializeSiteSettings(settings),
    settingsHash: HASH,
    createdBy: "user-owner",
    createdAt: at(),
  });
  return `set-rev-${key}`;
}

async function publishSettings(db, key, revisionId) {
  await db.insert(siteSettingsPublicationEvents).values({
    id: `set-pub-${key}`,
    requestKey: `set-publish-${key}`,
    revisionId,
    createdBy: "user-owner",
    createdAt: at(),
  });
}

test("contact details survive draft, publish, a later draft and a revert", async () => {
  const { sqlite, db } = setup();

  const first = settingsWith({
    email: "info@natheegroup2025.com",
    lineId: "@natheegroup",
    lineQrItemId: "gallery-line-qr-01",
    addressLines: ["99/9 หมู่ 9 ถนนสายเอเชีย", "ตำบลบ้านกรด"],
  });
  const firstRevision = await saveSettings(db, "one", first);

  // A draft alone changes nothing a reader is served.
  assert.equal((await getPublishedSiteSettings(db)).contact.email, "");

  await publishSettings(db, "one", firstRevision);
  const live = await getPublishedSiteSettings(db);
  assert.equal(live.contact.email, "info@natheegroup2025.com");
  assert.equal(live.contact.lineId, "@natheegroup");
  assert.equal(live.contact.lineQrItemId, "gallery-line-qr-01");
  assert.deepEqual(live.contact.addressLines, ["99/9 หมู่ 9 ถนนสายเอเชีย", "ตำบลบ้านกรด"]);

  // A second draft is saved and not published: the reader keeps the first.
  const second = settingsWith({ email: "sales@natheegroup2025.com", lineId: "", lineQrItemId: "", addressLines: [] });
  const secondRevision = await saveSettings(db, "two", second);
  assert.equal((await getPublishedSiteSettings(db)).contact.email, "info@natheegroup2025.com");

  await publishSettings(db, "two", secondRevision);
  const updated = await getPublishedSiteSettings(db);
  assert.equal(updated.contact.email, "sales@natheegroup2025.com");
  // Cleared fields are cleared, not remembered from the previous revision.
  assert.equal(updated.contact.lineQrItemId, "");
  assert.deepEqual(updated.contact.addressLines, []);

  // Revert is publishing the earlier revision again, not editing anything.
  await publishSettings(db, "revert", firstRevision);
  const reverted = await getPublishedSiteSettings(db);
  assert.equal(reverted.contact.email, "info@natheegroup2025.com");
  assert.equal(reverted.contact.lineQrItemId, "gallery-line-qr-01");
  assert.deepEqual(reverted.contact.addressLines, ["99/9 หมู่ 9 ถนนสายเอเชีย", "ตำบลบ้านกรด"]);

  // Both revisions are still there; a revert publishes, it does not rewrite.
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM site_settings_revisions").get().n, 2);
  sqlite.close();
});

test("a settings revision stored before these fields existed is still served", async () => {
  const { sqlite, db } = setup();
  const legacy = JSON.stringify({
    version: 1,
    brand: DEFAULT_SITE_SETTINGS.brand,
    contact: { primaryPhone: "063-194-1191", secondaryPhone: "085-680-2082" },
    navigation: DEFAULT_SITE_SETTINGS.navigation,
    footer: DEFAULT_SITE_SETTINGS.footer,
  });
  await db.insert(siteSettingsRevisions).values({
    id: "set-rev-legacy",
    requestKey: "set-save-legacy",
    settingsJson: legacy,
    settingsHash: HASH,
    createdBy: "user-owner",
    createdAt: at(),
  });
  await publishSettings(db, "legacy", "set-rev-legacy");

  const live = await getPublishedSiteSettings(db);
  assert.equal(live.contact.primaryPhone, "063-194-1191");
  assert.equal(live.contact.email, "");
  assert.deepEqual(live.contact.addressLines, []);
  sqlite.close();
});

// --- managed pages ----------------------------------------------------------

function pageWith(robots) {
  const parsed = parseCmsPageContent({
    ...DEFAULT_SITE_CONTENT.about,
    seo: { ...DEFAULT_SITE_CONTENT.about.seo, robots },
  });
  assert.ok(parsed, "the test page content was refused by the parser");
  return parsed;
}

async function savePage(db, key, content) {
  await db.insert(sitePageRevisions).values({
    id: `page-rev-${key}`,
    requestKey: `page-save-${key}`,
    pageId: "page-about",
    contentJson: serializeCmsPageContent(content),
    contentHash: HASH,
    createdBy: "user-owner",
    createdAt: at(),
  });
  return `page-rev-${key}`;
}

async function publishPage(db, key, revisionId) {
  await db.insert(sitePagePublicationEvents).values({
    id: `page-pub-${key}`,
    requestKey: `page-publish-${key}`,
    pageId: "page-about",
    revisionId,
    action: "PUBLISH",
    createdBy: "user-owner",
    createdAt: at(),
  });
}

test("page robots survives draft, publish and revert", async () => {
  const { sqlite, db } = setup();
  await db.insert(sitePages).values({
    id: "page-about",
    slug: "about",
    displayName: "เกี่ยวกับเรา",
    createdBy: "user-owner",
  });

  const indexed = await savePage(db, "one", pageWith("INDEX"));
  await publishPage(db, "one", indexed);
  let live = await getPublishedSitePage("about", db);
  assert.equal(live.status, "PUBLISHED");
  assert.equal(live.content.seo.robots, "INDEX");

  // Saving an unlisted draft does not unlist the live page.
  const unlisted = await savePage(db, "two", pageWith("NOINDEX"));
  live = await getPublishedSitePage("about", db);
  assert.equal(live.content.seo.robots, "INDEX", "a draft changed what the public is served");

  await publishPage(db, "two", unlisted);
  live = await getPublishedSitePage("about", db);
  assert.equal(live.status, "PUBLISHED", "an unlisted page must still be served");
  assert.equal(live.content.seo.robots, "NOINDEX");

  await publishPage(db, "revert", indexed);
  live = await getPublishedSitePage("about", db);
  assert.equal(live.content.seo.robots, "INDEX", "revert did not restore the previous setting");
  sqlite.close();
});

test("a page revision stored before the field existed is still served as indexable", async () => {
  const { sqlite, db } = setup();
  await db.insert(sitePages).values({
    id: "page-about",
    slug: "about",
    displayName: "เกี่ยวกับเรา",
    createdBy: "user-owner",
  });
  const legacy = JSON.stringify({
    version: 1,
    seo: { title: DEFAULT_SITE_CONTENT.about.seo.title, description: DEFAULT_SITE_CONTENT.about.seo.description },
    sections: DEFAULT_SITE_CONTENT.about.sections,
  });
  await db.insert(sitePageRevisions).values({
    id: "page-rev-legacy",
    requestKey: "page-save-legacy",
    pageId: "page-about",
    contentJson: legacy,
    contentHash: HASH,
    createdBy: "user-owner",
    createdAt: at(),
  });
  await publishPage(db, "legacy", "page-rev-legacy");

  const live = await getPublishedSitePage("about", db);
  assert.equal(live.status, "PUBLISHED");
  assert.equal(live.content.seo.robots, "INDEX");
  sqlite.close();
});

test("services add and edit are real append-only page revisions, never an implicit publish", async () => {
  const { sqlite, db } = setup();
  await db.insert(sitePages).values({
    id: "page-services",
    slug: "services",
    displayName: "บริการ",
    createdBy: "user-owner",
  });

  function servicesWith(items) {
    const content = structuredClone(DEFAULT_SITE_CONTENT.services);
    const section = content.sections.find((candidate) => candidate.id === "services-list");
    assert.ok(section, "the canonical Services page lost its services-list section");
    section.items = items;
    const parsed = parseCmsPageContent(content);
    assert.ok(parsed, "the Services editor produced content the server refuses");
    return parsed;
  }

  async function save(key, content) {
    const revisionId = `services-rev-${key}`;
    await db.batch([
      db.insert(sitePageRevisions).values({
        id: revisionId,
        requestKey: `services-save-${key}`,
        pageId: "page-services",
        contentJson: serializeCmsPageContent(content),
        contentHash: HASH,
        changeNote: `services ${key}`,
        createdBy: "user-owner",
        createdAt: at(),
      }),
      db.insert(auditLogs).values({
        id: `services-audit-${key}`,
        actorUserId: "user-owner",
        action: "CREATE_REVISION",
        entityType: "site_page",
        entityId: "page-services",
        afterJson: JSON.stringify({ revisionId, slug: "services" }),
      }),
    ]);
    return revisionId;
  }

  const addedContent = servicesWith([
    { title: "ขนส่งในประเทศ", body: "รับรถถึงปลายทางตามรอบงาน" },
  ]);
  const addedRevision = await save("add", addedContent);
  assert.equal((await getPublishedSitePage("services", db)).status, "UNMANAGED", "saving a new service published it");

  const storedAdd = parseCmsPageContent(JSON.parse(sqlite.prepare("SELECT content_json FROM site_page_revisions WHERE id = ?").get(addedRevision).content_json));
  assert.equal(storedAdd.sections.find((section) => section.id === "services-list").items[0].title, "ขนส่งในประเทศ");

  await db.insert(sitePagePublicationEvents).values({
    id: "services-pub-add",
    requestKey: "services-publish-add",
    pageId: "page-services",
    revisionId: addedRevision,
    action: "PUBLISH",
    createdBy: "user-owner",
    createdAt: at(),
  });

  const editedContent = servicesWith([
    { title: "ขนส่งในประเทศ", body: "รับรถถึงปลายทางพร้อมตรวจสถานะ" },
    { title: "จัดเก็บรถ", body: "จัดลานและตำแหน่งรถตามงานจริง" },
  ]);
  const editedRevision = await save("edit", editedContent);
  let live = await getPublishedSitePage("services", db);
  assert.equal(live.content.sections.find((section) => section.id === "services-list").items.length, 1, "an edited draft changed the public page");

  await db.insert(sitePagePublicationEvents).values({
    id: "services-pub-edit",
    requestKey: "services-publish-edit",
    pageId: "page-services",
    revisionId: editedRevision,
    action: "PUBLISH",
    createdBy: "user-owner",
    createdAt: at(),
  });
  live = await getPublishedSitePage("services", db);
  const liveServices = live.content.sections.find((section) => section.id === "services-list").items;
  assert.deepEqual(liveServices.map((item) => item.title), ["ขนส่งในประเทศ", "จัดเก็บรถ"]);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM site_page_revisions WHERE page_id = 'page-services'").get().n, 2);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM audit_logs WHERE entity_id = 'page-services'").get().n, 2);
  sqlite.close();
});
