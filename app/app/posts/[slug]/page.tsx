import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { PostEditor } from "@/components/post-editor";
import { PublishForm } from "@/components/publish-form";
import { getDb } from "@/db";
import { galleryItems } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { DEFAULT_POST_CONTENT, isValidPostSlug } from "@/lib/post-cms-content";
import { getPostEditorState } from "@/lib/post-cms-store";
import { POSTS_INDEX_PATH } from "@/lib/public-cms/posts";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ status?: string; error?: string; revision?: string; missing?: string }>;
};

const ERRORS: Record<string, string> = {
  invalid_content: "เนื้อหาไม่ครบตามที่หน้ารวมข่าวต้องใช้",
  invalid_publish: "คำสั่งเผยแพร่ไม่ถูกต้อง",
  post_not_found: "ไม่พบข่าวนี้",
  revision_not_found: "ไม่พบ Revision ที่เลือก",
  revision_unreadable: "Revision นี้อ่านไม่ได้ จึงเผยแพร่ไม่ได้",
  unpublishable_media: "มีรูปที่ยังไม่เผยแพร่หรือถูกเก็บแล้ว จึงเผยแพร่ไม่ได้",
  save_failed: "บันทึกไม่สำเร็จ กรุณาลองใหม่",
  publish_failed: "เผยแพร่ไม่สำเร็จ กรุณาลองใหม่",
};

const STATUSES: Record<string, string> = {
  saved: "บันทึก Revision แล้ว ยังไม่ขึ้นเว็บจนกว่าจะเผยแพร่",
  already_saved: "คำขอนี้ถูกบันทึกไปแล้ว ไม่ได้สร้างซ้ำ",
  published: "เผยแพร่แล้ว",
  hidden: "ยกเลิกการเผยแพร่แล้ว เนื้อหายังอยู่ครบและกลับมาเผยแพร่ได้",
  already_published: "คำขอนี้ถูกดำเนินการไปแล้ว",
};

export default async function PostEditPage({ params, searchParams }: Props) {
  const actor = await requireActor("/app/posts");
  if (!can(actor, "site:read")) redirect("/app");
  const { slug } = await params;
  if (!isValidPostSlug(slug)) notFound();
  const query = await searchParams;

  const state = await getPostEditorState(slug);
  if (!state) notFound();

  const mediaRows = await getDb()
    .select({ id: galleryItems.id, title: galleryItems.title })
    .from(galleryItems)
    .where(and(eq(galleryItems.status, "PUBLISHED"), eq(galleryItems.visibility, "PUBLIC")))
    .orderBy(desc(galleryItems.isFeatured), desc(galleryItems.createdAt))
    .limit(200)
    .all();
  const media = mediaRows.map((row) => ({ id: row.id, label: row.title }));

  const selected = query.revision
    ? state.revisions.find((revision) => revision.id === query.revision)
    : state.revisions[0];
  const initial = selected?.content ?? DEFAULT_POST_CONTENT;
  const canWrite = can(actor, "site:write");
  const canPublish = can(actor, "site:publish");
  const live = state.publication?.action === "PUBLISH" ? state.publication.revisionId : null;

  return (
    <>
      <div className="app-page-head">
        <div>
          <p>WEBSITE CMS · ข่าว</p>
          <h1>{selected?.content?.title ?? slug}</h1>
          <span>{POSTS_INDEX_PATH}{slug}/</span>
        </div>
        <Link className="button button-glass" href="/app/posts">กลับไปรายการข่าว</Link>
      </div>

      {query.error && (
        <p className="form-error">
          {ERRORS[query.error] ?? "ดำเนินการไม่สำเร็จ"}
          {query.missing ? ` (${query.missing})` : ""}
        </p>
      )}
      {query.status && <p className="form-message">{STATUSES[query.status] ?? query.status}</p>}

      <section className="app-panel cms-publication-panel">
        <div>
          <span className={`status-pill ${state.publication?.action ?? "DRAFT"}`}>
            {state.publication?.action ?? "DRAFT"}
          </span>
          <h2>สถานะเผยแพร่</h2>
          <p>
            {state.publication?.action === "PUBLISH"
              ? `เผยแพร่ Revision ${state.publication.revisionId?.slice(0, 8)}…`
              : state.publication?.action === "HIDE"
                ? "ยกเลิกการเผยแพร่แล้ว"
                : "ยังไม่เคยเผยแพร่"}
          </p>
          {state.publication?.publishedAt && (
            <small>
              เผยแพร่ครั้งแรก {new Date(state.publication.publishedAt).toLocaleString("th-TH")}
              {state.publication.updatedAt
                ? ` · แก้ไขล่าสุด ${new Date(state.publication.updatedAt).toLocaleString("th-TH")}`
                : " · ยังไม่เคยแก้ไขหลังเผยแพร่"}
            </small>
          )}
        </div>
        <div>
          {selected && (
            <Link className="button button-glass" href={`/app/posts/${slug}/preview?revision=${encodeURIComponent(selected.id)}`}>
              ดูตัวอย่าง
            </Link>
          )}
          {canPublish && selected && live !== selected.id && (
            <PublishForm
              action={`/api/posts/${slug}/publish`}
              fields={{ action: "PUBLISH", revisionId: selected.id, requestKey: `post-publish-${crypto.randomUUID()}` }}
              label="เผยแพร่ Revision นี้"
              busyLabel="กำลังเผยแพร่…"
            />
          )}
          {canPublish && state.publication?.action === "PUBLISH" && (
            <PublishForm
              action={`/api/posts/${slug}/publish`}
              fields={{ action: "HIDE", revisionId: "", requestKey: `post-publish-${crypto.randomUUID()}` }}
              label="ยกเลิกการเผยแพร่"
              busyLabel="กำลังยกเลิก…"
              confirm={`ยกเลิกการเผยแพร่บทความนี้ใช่หรือไม่? ผู้อ่านจะเปิด ${POSTS_INDEX_PATH}${slug}/ ไม่ได้ เนื้อหาและประวัติยังอยู่ครบและกลับมาเผยแพร่ได้`}
            />
          )}
        </div>
      </section>

      {canWrite && <PostEditor action={`/api/posts/${slug}/revisions`} initial={initial} media={media} />}

      <section className="detail-section">
        <div className="detail-section-head">
          <div>
            <p>REVISION HISTORY</p>
            <h2>ประวัติย้อนหลัง</h2>
          </div>
          <span>แสดงล่าสุด {state.revisions.length} รายการ</span>
        </div>
        <div className="cms-revision-list">
          {state.revisions.map((revision) => (
            <article className="app-panel" key={revision.id}>
              <div>
                <b>{revision.id.slice(0, 8)}…</b>
                {live === revision.id && <span className="status-pill PUBLISH">LIVE</span>}
              </div>
              <p>{revision.changeNote || "ไม่มีหมายเหตุ"}</p>
              <small>
                {revision.author} · {new Date(revision.createdAt).toLocaleString("th-TH")} · SHA{" "}
                {revision.contentHash.slice(0, 12)}…
              </small>
              <div>
                <Link href={`/app/posts/${slug}?revision=${encodeURIComponent(revision.id)}`}>เปิดแก้จาก Revision นี้</Link>
                <Link href={`/app/posts/${slug}/preview?revision=${encodeURIComponent(revision.id)}`}>ดูตัวอย่าง</Link>
                {canPublish && live !== revision.id && (
                  <PublishForm
                    action={`/api/posts/${slug}/publish`}
                    fields={{ action: "PUBLISH", revisionId: revision.id, requestKey: `post-publish-${crypto.randomUUID()}` }}
                    label="ย้อนกลับมาเผยแพร่"
                    busyLabel="กำลังเผยแพร่…"
                  />
                )}
              </div>
            </article>
          ))}
        </div>
        {state.revisions.length === 0 && (
          <div className="app-panel app-empty">
            <h2>ยังไม่มี Revision</h2>
          </div>
        )}
      </section>
    </>
  );
}

