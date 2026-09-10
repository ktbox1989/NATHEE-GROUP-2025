import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { galleryCategories, posts, postRevisions } from "@/db/schema";
import { listPosts } from "@/lib/post-cms-store";
import { POSTS_INDEX_PATH } from "@/lib/public-cms/posts";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid_slug: "Slug ไม่ถูกต้อง: ตัวพิมพ์เล็ก a-z ตัวเลข ขีดกลาง และห้ามเป็นชื่อที่ระบบสงวนไว้",
  slug_taken: "Slug นี้ถูกใช้แล้ว",
  invalid_content: "เนื้อหาไม่ครบ: หัวข้ออย่างน้อย 3 ตัวอักษร และสรุปย่ออย่างน้อย 20 ตัวอักษร",
  forbidden: "บัญชีนี้ไม่มีสิทธิ์เขียนเนื้อหาเว็บไซต์",
  save: "บันทึกไม่สำเร็จ ลองใหม่",
  revision_not_found: "ไม่พบ Revision ที่จะเผยแพร่",
  unpublishable_media: "มีรูปหรือหมวดแกลเลอรีที่ยังไม่เผยแพร่ จึงเผยแพร่ไม่ได้",
  publish_failed: "เผยแพร่ไม่สำเร็จ ลองใหม่",
};

const STATUSES: Record<string, string> = {
  created: "สร้างบทความเรียบร้อย (ยังไม่ขึ้นเว็บจนกว่าจะกดเผยแพร่)",
  already_saved: "บันทึกไปแล้ว",
  published: "เผยแพร่แล้ว ผู้อ่านเปิดได้ที่หน้าข่าวจริง",
  hidden: "ยกเลิกการเผยแพร่แล้ว เนื้อหายังอยู่ครบ",
};

/**
 * News management in one page: the real list with its live state, a plain
 * create form (with the optional work-gallery section), and publish/unpublish
 * buttons per post — all native forms posting to the audited endpoints.
 */
export default async function AdminPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const query = await searchParams;
  const db = getDb();

  const [summaries, categoryRows] = await Promise.all([
    listPosts(),
    db
      .select({ slug: galleryCategories.slug, name: galleryCategories.name })
      .from(galleryCategories)
      .where(eq(galleryCategories.status, "ACTIVE"))
      .orderBy(galleryCategories.sortOrder, galleryCategories.name)
      .limit(100)
      .all(),
  ]);

  // The latest revision of each post, so the publish button names exactly the
  // revision the owner just saved — read from the same tables the editor uses.
  const latestRevisions = new Map<string, string>();
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

  return (
    <>
      <div className="app-page-head">
        <div>
          <p>ข่าวและบทความ</p>
          <h1>จัดการข่าว</h1>
          <span>เผยแพร่ที่ {POSTS_INDEX_PATH} · ทุกปุ่มกดแล้วทำงานจริงบนเซิร์ฟเวอร์</span>
        </div>
        { }
        <a className="button button-glass" href="/admin">กลับหน้าหลัก</a>
      </div>

      {query.error && <p className="form-error">{ERRORS[query.error] ?? "ดำเนินการไม่สำเร็จ"}</p>}
      {query.status && <p className="form-message">{STATUSES[query.status] ?? query.status}</p>}

      <section className="app-panel">
        <h2>สร้างบทความใหม่</h2>
        <form className="record-form" action="/api/admin/posts" method="post">
          <label className="field">
            <span>Slug (URL ถาวร) *</span>
            <input name="slug" required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="new-route-bangkok" />
          </label>
          <label className="field">
            <span>หัวข้อ *</span>
            <input name="title" required minLength={3} maxLength={300} />
          </label>
          <label className="field full">
            <span>สรุปย่อ (แสดงในหน้ารวมข่าว) *</span>
            <input name="excerpt" required minLength={20} maxLength={500} />
          </label>
          <label className="field">
            <span>หมวดหมู่ (ไม่บังคับ)</span>
            <input name="categoryLabel" maxLength={80} placeholder="เช่น ประกาศ" />
          </label>
          <label className="field full">
            <span>เนื้อหา *</span>
            <textarea name="body" required rows={6} maxLength={2000} placeholder="เนื้อหาบทความ..." />
          </label>
          <label className="field">
            <span>แนบภาพผลงานจากหมวด Gallery (ไม่บังคับ)</span>
            <select name="galleryCategorySlug" defaultValue="">
              <option value="">ไม่แนบภาพผลงาน</option>
              {categoryRows.map((category) => (
                <option key={category.slug} value={category.slug}>{category.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>จำนวนภาพ (1-24)</span>
            <input type="number" name="galleryLimit" min={1} max={24} defaultValue={12} />
          </label>
          <label className="field full">
            <span>หมายเหตุการแก้ไข</span>
            <input name="changeNote" maxLength={500} />
          </label>
          <div className="full">
            <button type="submit" className="button button-gradient">สร้างบทความ (ฉบับร่าง)</button>
          </div>
        </form>
      </section>

      <section className="app-panel">
        <h2>บทความทั้งหมด ({summaries.length})</h2>
        {summaries.length === 0 ? (
          <div className="app-empty">
            <h3>ยังไม่มีบทความ</h3>
            <p>สร้างบทความแรกจากแบบฟอร์มด้านบน</p>
          </div>
        ) : (
          <div className="record-list">
            {summaries.map((summary) => {
              const latest = latestRevisions.get(summary.slug);
              const live = summary.state === "PUBLISHED";
              return (
                <article className="record-row" key={summary.slug}>
                  <b>{summary.title ?? summary.slug}</b>
                  <span>{POSTS_INDEX_PATH}{summary.slug}/</span>
                  <span className={`status-pill ${summary.state}`}>{summary.state}</span>
                  {live ? (
                    <>
                      <a className="button button-glass" href={`${POSTS_INDEX_PATH}${summary.slug}/`}>เปิดหน้าจริง</a>
                      <form action={`/api/posts/${encodeURIComponent(summary.slug)}/publish`} method="post">
                        <input type="hidden" name="returnTo" value="/admin/posts" />
                        <input type="hidden" name="action" value="HIDE" />
                        <input type="hidden" name="requestKey" value={`admin-hide-${crypto.randomUUID()}`} />
                        <button type="submit" className="button button-glass">ยกเลิกเผยแพร่</button>
                      </form>
                    </>
                  ) : (
                    latest && (
                      <form action={`/api/posts/${encodeURIComponent(summary.slug)}/publish`} method="post">
                        <input type="hidden" name="returnTo" value="/admin/posts" />
                        <input type="hidden" name="action" value="PUBLISH" />
                        <input type="hidden" name="revisionId" value={latest} />
                        <input type="hidden" name="requestKey" value={`admin-publish-${crypto.randomUUID()}`} />
                        <button type="submit" className="button button-gradient">เผยแพร่</button>
                      </form>
                    )
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
