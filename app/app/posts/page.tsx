import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { PostEditor } from "@/components/post-editor";
import { getDb } from "@/db";
import { galleryItems } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { DEFAULT_POST_CONTENT } from "@/lib/post-cms-content";
import { listPosts } from "@/lib/post-cms-store";
import { POSTS_INDEX_PATH } from "@/lib/public-cms/posts";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid_slug: "Slug ต้องเป็นตัวพิมพ์เล็กภาษาอังกฤษคั่นด้วยขีดเดียว และต้องไม่ใช่ชื่อที่ระบบสงวนไว้",
  slug_taken: "Slug นี้ถูกใช้แล้ว",
  invalid_content: "เนื้อหาไม่ครบตามที่หน้ารวมข่าวต้องใช้",
  save_failed: "บันทึกไม่สำเร็จ กรุณาลองใหม่",
};

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await requireActor("/app/posts");
  if (!can(actor, "site:read")) redirect("/app");
  const { error } = await searchParams;

  const [summaries, mediaRows] = await Promise.all([
    listPosts(),
    getDb()
      .select({ id: galleryItems.id, title: galleryItems.title })
      .from(galleryItems)
      .where(and(eq(galleryItems.status, "PUBLISHED"), eq(galleryItems.visibility, "PUBLIC")))
      .orderBy(desc(galleryItems.isFeatured), desc(galleryItems.createdAt))
      .limit(200)
      .all(),
  ]);
  const media = mediaRows.map((row) => ({ id: row.id, label: row.title }));
  const canWrite = can(actor, "site:write");

  return (
    <>
      <div className="app-page-head">
        <div>
          <p>WEBSITE CMS</p>
          <h1>ข่าวและบทความ</h1>
          <span>เผยแพร่ที่ {POSTS_INDEX_PATH} แก้ไขแบบ Revision และย้อนกลับได้เสมอ</span>
        </div>
        <div className="app-page-actions">
          {canWrite && <Link className="button button-gradient" href="#new-post">+ เพิ่มบทความ</Link>}
          <Link className="button button-glass" href="/app/website">ภาพรวมเว็บไซต์</Link>
        </div>
      </div>

      {error && <p className="form-error">{ERRORS[error] ?? "ดำเนินการไม่สำเร็จ"}</p>}

      <section className="site-page-grid">
        {summaries.map((summary) => (
          <article className="app-panel" key={summary.slug}>
            <span className={`status-pill ${summary.state}`}>{summary.state}</span>
            <h2>{summary.title ?? summary.slug}</h2>
            {/* A published post has a URL a reader can open; an unpublished one
                has the same path and no page behind it, so it is shown as text
                rather than as a link that would 404. */}
            {summary.state === "PUBLISHED" ? (
              <p>
                <Link href={`${POSTS_INDEX_PATH}${summary.slug}/`} target="_blank" rel="noreferrer">
                  {POSTS_INDEX_PATH}{summary.slug}/
                </Link>
              </p>
            ) : (
              <p>
                {POSTS_INDEX_PATH}{summary.slug}/ · {summary.state === "HIDDEN" ? "ยกเลิกการเผยแพร่แล้ว ผู้อ่านเปิดไม่ได้" : "ยังไม่เผยแพร่ ผู้อ่านเปิดไม่ได้"}
              </p>
            )}
            <small>
              {summary.revisionCount}{summary.revisionCount >= 20 ? "+" : ""} revisions · อัปเดต{" "}
              {new Date(summary.updatedAt).toLocaleString("th-TH")}
            </small>
            <div>
              <Link className="button button-gradient" href={`/app/posts/${summary.slug}`}>แก้ไขและเผยแพร่</Link>
              {summary.state === "PUBLISHED" && (
                <Link className="button button-glass" href={`${POSTS_INDEX_PATH}${summary.slug}/`} target="_blank" rel="noreferrer">
                  เปิดหน้าจริง
                </Link>
              )}
            </div>
          </article>
        ))}
        {summaries.length === 0 && (
          <div className="app-panel app-empty">
            <h2>ยังไม่มีข่าว</h2>
            <p>สร้างข่าวแรกด้านล่าง เนื้อหาจะยังไม่ขึ้นเว็บจนกว่าจะกดเผยแพร่</p>
          </div>
        )}
      </section>

      {canWrite && (
        <section className="app-panel" id="new-post">
          <h2>สร้างข่าวใหม่</h2>
          <p>Slug กำหนดเป็น URL ถาวรและเปลี่ยนภายหลังไม่ได้ เพราะจะทำให้ลิงก์เดิมเสีย</p>
          <PostEditor action="/api/posts" slugField initial={DEFAULT_POST_CONTENT} media={media} />
        </section>
      )}
    </>
  );
}
