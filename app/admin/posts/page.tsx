import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { galleryCategories, posts, postRevisions } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireAdminPermission } from "@/lib/admin-access";
import { listPosts } from "@/lib/post-cms-store";
import { POSTS_INDEX_PATH } from "@/lib/public-cms/posts";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid_slug: "Slug ไม่ถูกต้อง: ใช้ a-z ตัวเลข และขีดกลางเท่านั้น",
  slug_taken: "Slug นี้ถูกใช้แล้ว",
  invalid_content: "เนื้อหาไม่ครบ: หัวข้ออย่างน้อย 3 ตัวอักษร และสรุปย่ออย่างน้อย 20 ตัวอักษร",
  forbidden: "บัญชีนี้ไม่มีสิทธิ์ดำเนินการกับเนื้อหาเว็บไซต์",
  save: "บันทึกไม่สำเร็จ ลองใหม่",
  revision_not_found: "ไม่พบ Revision ที่จะเผยแพร่",
  unpublishable_media: "มีรูปหรือหมวด Gallery ที่ยังไม่เผยแพร่ จึงเผยแพร่ไม่ได้",
  publish_failed: "เผยแพร่ไม่สำเร็จ ลองใหม่",
};

const STATUSES: Record<string, string> = {
  created: "สร้างบทความเรียบร้อย (ยังไม่ขึ้นเว็บจนกว่าจะกดเผยแพร่)",
  already_saved: "บันทึกไปแล้ว",
  published: "เผยแพร่แล้ว ผู้อ่านเปิดได้ที่หน้าข่าวจริง",
  hidden: "ยกเลิกการเผยแพร่แล้ว เนื้อหายังอยู่ครบ",
};

export default async function AdminPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const actor = await requireAdminPermission("site:read", "/admin/posts");
  const query = await searchParams;
  const db = getDb();
  const canWrite = can(actor, "site:write");
  const canPublish = can(actor, "site:publish");

  const [summaries, categoryRows] = await Promise.all([
    listPosts(),
    canWrite
      ? db
          .select({ slug: galleryCategories.slug, name: galleryCategories.name })
          .from(galleryCategories)
          .where(eq(galleryCategories.status, "ACTIVE"))
          .orderBy(galleryCategories.sortOrder, galleryCategories.name)
          .limit(100)
          .all()
      : Promise.resolve([]),
  ]);

  const latestRevisions = new Map<string, string>();
  if (canPublish) {
    for (const summary of summaries) {
      const row = await db
        .select({ id: postRevisions.id })
        .from(postRevisions)
        .innerJoin(posts, eq(posts.id, postRevisions.postId))
        .where(eq(posts.slug, summary.slug))
        .orderBy(desc(postRevisions.createdAt), desc(postRevisions.id))
        .limit(1)
        .get();
      if (row) latestRevisions.set(summary.slug, row.id);
    }
  }

  const publishedCount = summaries.filter((summary) => summary.state === "PUBLISHED").length;

  return (
    <>
      <section className="admin-page-hero compact">
        <div>
          <span className="admin-eyebrow">CONTENT & NEWS</span>
          <h1>ข่าวและบทความ</h1>
          <p>จัดการข่าวจากฐานข้อมูลจริง เนื้อหาจะขึ้นหน้าเว็บสาธารณะเมื่อผ่านขั้นตอน Publish เท่านั้น</p>
        </div>
        <div className="admin-hero-actions">
          {canWrite && <a className="admin-button primary" href="#new-post">+ สร้างบทความ</a>}
          <a className="admin-button" href={POSTS_INDEX_PATH} target="_blank" rel="noreferrer">เปิดหน้าข่าวจริง</a>
        </div>
      </section>

      <section className="admin-mini-stats">
        <article><span>ทั้งหมด</span><b>{summaries.length}</b></article>
        <article><span>เผยแพร่แล้ว</span><b>{publishedCount}</b></article>
        <article><span>ยังไม่เผยแพร่</span><b>{summaries.length - publishedCount}</b></article>
      </section>

      {query.error && <p className="admin-alert error" role="alert">{ERRORS[query.error] ?? "ดำเนินการไม่สำเร็จ"}</p>}
      {query.status && <p className="admin-alert success" role="status">{STATUSES[query.status] ?? query.status}</p>}

      {canWrite && (
        <section className="admin-card admin-form-card" id="new-post">
          <div className="admin-card-head">
            <div>
              <span className="admin-eyebrow">NEW ARTICLE</span>
              <h2>สร้างบทความใหม่</h2>
              <p>บันทึกเป็นฉบับร่างก่อน แล้วจึงเผยแพร่เมื่อเนื้อหาและภาพพร้อม</p>
            </div>
          </div>
          <form className="admin-form-grid" action="/api/admin/posts" method="post">
            <label className="admin-field">
              <span>Slug (URL ถาวร) *</span>
              <input name="slug" required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="new-route-bangkok" />
              <small>ใช้ a-z, 0-9 และขีดกลางเท่านั้น</small>
            </label>
            <label className="admin-field">
              <span>หัวข้อ *</span>
              <input name="title" required minLength={3} maxLength={300} placeholder="หัวข้อข่าวหรือบทความ" />
            </label>
            <label className="admin-field span-2">
              <span>สรุปย่อ *</span>
              <textarea name="excerpt" required minLength={20} maxLength={500} rows={3} placeholder="สรุปให้ผู้อ่านเข้าใจสาระสำคัญก่อนเปิดอ่าน" />
            </label>
            <label className="admin-field">
              <span>หมวดหมู่</span>
              <input name="categoryLabel" maxLength={80} placeholder="เช่น ข่าวบริษัท / ประกาศ" />
            </label>
            <label className="admin-field span-2">
              <span>เนื้อหา *</span>
              <textarea name="body" required rows={8} maxLength={2000} placeholder="เนื้อหาบทความ..." />
            </label>
            <label className="admin-field">
              <span>ภาพผลงานจาก Gallery</span>
              <select name="galleryCategorySlug" defaultValue="">
                <option value="">ไม่แนบภาพผลงาน</option>
                {categoryRows.map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}
              </select>
            </label>
            <label className="admin-field">
              <span>จำนวนภาพ</span>
              <input type="number" name="galleryLimit" min={1} max={24} defaultValue={12} />
            </label>
            <label className="admin-field span-2">
              <span>หมายเหตุการแก้ไข</span>
              <input name="changeNote" maxLength={500} placeholder="เช่น เพิ่มข่าวกิจกรรมเดือนกันยายน" />
            </label>
            <div className="admin-form-actions span-2">
              <button type="submit" className="admin-button primary">สร้างบทความฉบับร่าง</button>
            </div>
          </form>
        </section>
      )}

      <section className="admin-card admin-list-card">
        <div className="admin-card-head">
          <div>
            <span className="admin-eyebrow">ARTICLE LIBRARY</span>
            <h2>บทความทั้งหมด</h2>
            <p>สถานะบนรายการนี้มาจาก CMS จริง</p>
          </div>
          <a href="/app/posts">เปิดตัวแก้ไขแบบเต็ม</a>
        </div>

        {summaries.length === 0 ? (
          <div className="admin-empty">
            <span aria-hidden="true">◩</span>
            <h3>ยังไม่มีบทความ</h3>
            <p>{canWrite ? "สร้างบทความแรกจากแบบฟอร์มด้านบน" : "ยังไม่มีเนื้อหาที่แสดงได้"}</p>
          </div>
        ) : (
          <div className="admin-post-list">
            {summaries.map((summary) => {
              const latest = latestRevisions.get(summary.slug);
              const live = summary.state === "PUBLISHED";
              return (
                <article className="admin-post-row" key={summary.slug}>
                  <div className="admin-post-copy">
                    <span className="admin-eyebrow">{summary.slug}</span>
                    <h3>{summary.title ?? summary.slug}</h3>
                    <small>{POSTS_INDEX_PATH}{summary.slug}/</small>
                  </div>
                  <span className={`admin-status-pill ${summary.state}`}>{live ? "เผยแพร่แล้ว" : "ฉบับร่าง"}</span>
                  <div className="admin-post-actions">
                    {live && (
                      <a className="admin-button subtle" href={`${POSTS_INDEX_PATH}${summary.slug}/`} target="_blank" rel="noreferrer">
                        เปิดหน้าจริง
                      </a>
                    )}
                    {canPublish && live && (
                      <form action={`/api/posts/${encodeURIComponent(summary.slug)}/publish`} method="post">
                        <input type="hidden" name="returnTo" value="/admin/posts" />
                        <input type="hidden" name="action" value="HIDE" />
                        <input type="hidden" name="requestKey" value={`admin-hide-${crypto.randomUUID()}`} />
                        <button type="submit" className="admin-button danger">ถอนเผยแพร่</button>
                      </form>
                    )}
                    {canPublish && !live && latest && (
                      <form action={`/api/posts/${encodeURIComponent(summary.slug)}/publish`} method="post">
                        <input type="hidden" name="returnTo" value="/admin/posts" />
                        <input type="hidden" name="action" value="PUBLISH" />
                        <input type="hidden" name="revisionId" value={latest} />
                        <input type="hidden" name="requestKey" value={`admin-publish-${crypto.randomUUID()}`} />
                        <button type="submit" className="admin-button primary">เผยแพร่</button>
                      </form>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
