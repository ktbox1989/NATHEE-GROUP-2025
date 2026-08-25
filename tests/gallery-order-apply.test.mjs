import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { asc, eq } from "drizzle-orm";
import { auditLogs, galleryItems } from "../db/schema.ts";
import { assignGalleryPositions } from "../lib/gallery-order.ts";
import { d1Over, migratedSqlite } from "./support/d1-over-sqlite.mjs";

// A reorder is many writes and one outcome.
//
// The property worth proving is not the happy path. It is that a failure part
// way through leaves the order that was already there - because half a reorder
// is a third order that nobody chose, and neither of the other two can be
// recovered from what is left. That is the whole reason the endpoint exists:
// the reorder screen's sequential writes cannot give it.

function setup() {
  const sqlite = migratedSqlite();
  sqlite.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('user-owner', 'auth-owner', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO user_role_assignments (user_id, role, assigned_by)
    VALUES ('user-owner', 'OWNER', 'user-owner');
    INSERT INTO gallery_categories (id, slug, name, created_by)
    VALUES ('cat-1', 'truck-loading', 'Truck loading', 'user-owner');
  `);
  return { sqlite, db: drizzle(d1Over(sqlite)) };
}

let counter = 0;
function addItem(sqlite, id, sortOrder, status = "PUBLISHED") {
  counter += 1;
  const published = status === "PUBLISHED" ? "'user-owner', '2026-08-25 00:00:00'" : "NULL, NULL";
  sqlite.exec(
    `INSERT INTO gallery_items (id, request_key, category_id, title, alt_text, status, visibility, sort_order, uploaded_by, published_by, published_at)
     VALUES ('${id}', 'rk-${counter}', 'cat-1', 'Photo ${id}', 'A photograph of loading work', '${status}', 'PUBLIC', ${sortOrder}, 'user-owner', ${published})`,
  );
}

function orderOf(sqlite) {
  return sqlite
    .prepare("SELECT id, sort_order FROM gallery_items ORDER BY sort_order, id")
    .all()
    .map((row) => `${row.id}:${row.sort_order}`);
}

/**
 * The batch the route builds: every position, then one audit row whose id is
 * derived from the request key.
 */
function reorder(db, ids, auditId = `gallery-order-${ids.join("")}`) {
  const positions = assignGalleryPositions(ids);
  const [first, ...rest] = positions;
  const place = (position) =>
    db
      .update(galleryItems)
      .set({ sortOrder: position.sortOrder, updatedAt: "2026-08-25 10:00:00" })
      .where(eq(galleryItems.id, position.id));
  return db.batch([
    place(first),
    ...rest.map(place),
    db.insert(auditLogs).values({
      id: auditId,
      actorUserId: "user-owner",
      action: "REORDER",
      entityType: "gallery_order",
      entityId: "cat-1",
      afterJson: JSON.stringify({ categoryId: "cat-1", order: positions }),
    }),
  ]);
}

test("a reorder places every photograph in the order it was given", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, "item-a", 0);
  addItem(sqlite, "item-b", 0);
  addItem(sqlite, "item-c", 0);

  await reorder(db, ["item-c", "item-a", "item-b"]);

  assert.deepEqual(orderOf(sqlite), ["item-c:10", "item-a:20", "item-b:30"]);
  sqlite.close();
});

// The audit row is the last statement in the batch, so making it fail is the
// realistic shape of a late failure: every position has already been written
// when it happens.
test("a reorder that fails part way leaves the order that was already there", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, "item-a", 10);
  addItem(sqlite, "item-b", 20);
  addItem(sqlite, "item-c", 30);

  await reorder(db, ["item-c", "item-b", "item-a"], "gallery-order-first");
  const afterFirst = orderOf(sqlite);
  assert.deepEqual(afterFirst, ["item-c:10", "item-b:20", "item-a:30"]);

  await assert.rejects(() => reorder(db, ["item-b", "item-a", "item-c"], "gallery-order-first"));

  assert.deepEqual(orderOf(sqlite), afterFirst, "a rolled-back reorder still moved rows");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM audit_logs").get().n, 1);
  sqlite.close();
});

// Idempotency without a new table: the audit id is derived from the request
// key, so replaying one submission collides with the primary key and the whole
// batch rolls back rather than renumbering a second time.
test("replaying one submission cannot reorder twice", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, "item-a", 0);
  addItem(sqlite, "item-b", 0);

  await reorder(db, ["item-b", "item-a"], "gallery-order-same-key");
  const once = orderOf(sqlite);

  // A different order, replayed under the same key: refused whole.
  await assert.rejects(() => reorder(db, ["item-a", "item-b"], "gallery-order-same-key"));
  assert.deepEqual(orderOf(sqlite), once);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM audit_logs").get().n, 1);
  sqlite.close();
});

// A reorder is one decision about a sequence, not one decision per photograph.
test("a reorder records one audit row carrying the whole sequence", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, "item-a", 10);
  addItem(sqlite, "item-b", 20);
  await reorder(db, ["item-b", "item-a"]);

  const rows = sqlite.prepare("SELECT action, entity_type, entity_id, after_json FROM audit_logs").all();
  assert.equal(rows.length, 1, "a reorder produced more than one audit row");
  assert.equal(rows[0].action, "REORDER");
  assert.equal(rows[0].entity_type, "gallery_order");
  assert.equal(rows[0].entity_id, "cat-1");
  assert.deepEqual(JSON.parse(rows[0].after_json).order, [
    { id: "item-b", sortOrder: 10 },
    { id: "item-a", sortOrder: 20 },
  ]);
  // And it cannot be rewritten afterwards.
  assert.throws(() => sqlite.exec("UPDATE audit_logs SET action = 'NOTHING'"), /append-only|immutable|cannot/i);
  sqlite.close();
});

// A gap between positions is what lets a single later insert take a place
// without rewriting the whole sequence.
test("a photograph can be placed between two others without renumbering them", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, "item-a", 0);
  addItem(sqlite, "item-b", 0);
  await reorder(db, ["item-a", "item-b"]);

  addItem(sqlite, "item-new", 0);
  await db.update(galleryItems).set({ sortOrder: 15 }).where(eq(galleryItems.id, "item-new"));

  assert.deepEqual(orderOf(sqlite), ["item-a:10", "item-new:15", "item-b:20"]);
  sqlite.close();
});

// The order has to be the one the public listing reads, or it is a number in a
// column that changes nothing.
test("the public listing reads the order that was set", async () => {
  const { sqlite, db } = setup();
  addItem(sqlite, "item-a", 0);
  addItem(sqlite, "item-b", 0);
  addItem(sqlite, "item-draft", 0, "DRAFT");
  await reorder(db, ["item-b", "item-a"]);

  const listed = await db
    .select({ id: galleryItems.id })
    .from(galleryItems)
    .where(eq(galleryItems.status, "PUBLISHED"))
    .orderBy(asc(galleryItems.sortOrder), asc(galleryItems.id))
    .all();

  assert.deepEqual(listed.map((row) => row.id), ["item-b", "item-a"]);
  // The draft was never named and was never touched.
  assert.equal(sqlite.prepare("SELECT sort_order FROM gallery_items WHERE id = 'item-draft'").get().sort_order, 0);
  sqlite.close();
});
