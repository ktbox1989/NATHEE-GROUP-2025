import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { GalleryOrderBoard, type GalleryOrderItem } from "@/components/gallery-order-board";
import { GALLERY_ORDER_MAX_ITEMS } from "@/lib/gallery-order";
import { getDb } from "@/db";
import { galleryCategories, galleryItems } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";

export const dynamic = "force-dynamic";

/**
 * The order the public /gallery page serves, shown in that order.
 *
 * The Media Library lists newest first, which is the right order for finding a
 * photograph you just uploaded and the wrong one for deciding what a visitor
 * sees first — there was no screen anywhere that showed the public sequence, so
 * the position field could be edited but its effect could not be seen.
 *
 * Ordering here mirrors app/gallery/page.tsx exactly. Embedded gallery sections
 * on a CMS page additionally float featured images to the top, which is why a
 * featured item is marked rather than silently sorted differently.
 */
// The endpoint refuses a partial order, so the screen must hold the complete
// set for one category. One more than the bound is fetched so a category that
// is too large is reported rather than silently ordered in part.
const PAGE_SIZE = GALLERY_ORDER_MAX_ITEMS;

/**
 * What each refusal from `POST /api/gallery/order` means to the Owner.
 *
 * Printed as words rather than as the code, because every one of these is
 * something the person in front of the screen can act on — and because a
 * refusal that reads as a system fault invites a retry that will fail the same
 * way.
 */
const ORDER_ERRORS: Record<string, string> = {
  forbidden: "บัญชีนี้ไม่มีสิทธิ์จัดลำดับรูป",
  invalid_request_key: "รหัสคำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง",
  invalid_category: "ไม่พบหมวดนี้ กรุณาเลือกหมวดใหม่",
  invalid_order_empty: "ไม่ได้ส่งลำดับมา กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง",
  invalid_order_too_many: "ส่งรูปมามากเกินกว่าที่จัดลำดับได้ในครั้งเดียว",
  invalid_order_invalid_id: "มีรหัสรูปที่ไม่ถูกต้องอยู่ในลำดับ กรุณาโหลดหน้าใหม่",
  invalid_order_duplicate_id: "มีรูปซ้ำกันในลำดับ กรุณาโหลดหน้าใหม่",
  unknown_item: "มีรูปที่ไม่มีอยู่แล้วอยู่ในลำดับ อาจถูกลบระหว่างที่เปิดหน้านี้ค้างไว้ กรุณาโหลดหน้าใหม่",
  wrong_category: "มีรูปที่ไม่ได้อยู่ในหมวดนี้ กรุณาโหลดหน้าใหม่",
  not_public: "มีรูปที่ไม่ได้เผยแพร่หรือไม่เป็นสาธารณะแล้ว กรุณาโหลดหน้าใหม่",
  incomplete_order: "ลำดับที่ส่งไปไม่ครบทั้งหมวด ระบบจึงไม่บันทึก เพราะรูปที่ไม่ได้ส่งจะไปอยู่ข้างหน้าทั้งหมด",
  category_too_large: "หมวดนี้มีรูปมากเกินกว่าจะจัดลำดับในครั้งเดียว",
  gallery_order: "บันทึกลำดับไม่สำเร็จ ไม่มีรูปใดถูกย้าย กรุณาลองใหม่",
};

type Props = { searchParams: Promise<{ category?: string; status?: string; error?: string }> };

export default async function GalleryOrderPage({ searchParams }: Props) {
  const actor = await requireActor("/app/gallery/order");
  if (!can(actor, "gallery:read")) redirect("/app");
  const params = await searchParams;
  const db = getDb();

  const categories = await db
    .select({ id: galleryCategories.id, slug: galleryCategories.slug, name: galleryCategories.name, status: galleryCategories.status })
    .from(galleryCategories)
    .orderBy(galleryCategories.sortOrder, galleryCategories.name)
    .all();
  const active = categories.find((category) => category.slug === params.category) ?? null;
  // Where the board sends the Owner after a save, so the order they see next is
  // read back from the database rather than the one the browser was holding.
  const returnTo = active ? `/app/gallery/order?category=${encodeURIComponent(active.slug)}` : "/app/gallery/order";

  const items = await db
    .select({
      id: galleryItems.id,
      title: galleryItems.title,
      altText: galleryItems.altText,
      caption: galleryItems.caption,
      takenAt: galleryItems.takenAt,
      location: galleryItems.location,
      publicJobReference: galleryItems.publicJobReference,
      categoryId: galleryItems.categoryId,
      visibility: galleryItems.visibility,
      companyId: galleryItems.companyId,
      jobId: galleryItems.jobId,
      sortOrder: galleryItems.sortOrder,
      isFeatured: galleryItems.isFeatured,
      createdAt: galleryItems.createdAt,
    })
    .from(galleryItems)
    .where(
      and(
        eq(galleryItems.status, "PUBLISHED"),
        eq(galleryItems.visibility, "PUBLIC"),
        active ? eq(galleryItems.categoryId, active.id) : undefined,
      ),
    )
    .orderBy(asc(galleryItems.sortOrder), desc(galleryItems.createdAt), desc(galleryItems.id))
    .limit(PAGE_SIZE + 1)
    .all();

  const canWrite = can(actor, "gallery:write");
  // Reordering is per category, because only then can the complete set be sent.
  const tooLarge = items.length > PAGE_SIZE;
  const canReorder = canWrite && active !== null && !tooLarge && items.length > 1;
  // Two items with the same number fall back to newest-first, so the Owner is
  // told rather than left to wonder why a move did nothing.
  const tied = items.length - new Set(items.map((item) => item.sortOrder)).size;

  return (
    <>
      <div className="app-page-head">
        <div>
          <p>MEDIA LIBRARY</p>
          <h1>ลำดับการแสดงผลบนเว็บไซต์</h1>
          <span>เรียงตามที่ผู้เข้าชมเห็นจริงในหน้าผลงาน · แสดงเฉพาะรูปสาธารณะที่เผยแพร่แล้ว</span>
        </div>
        <Link className="button button-glass" href="/app/gallery">กลับไป Media Library</Link>
      </div>

      {params.status === "reordered" && <div className="form-message success page-message">บันทึกลำดับใหม่แล้ว · ลำดับด้านล่างอ่านจากฐานข้อมูลจริง</div>}
      {params.status === "already_ordered" && <div className="form-message success page-message">คำขอนี้ถูกบันทึกไปแล้ว ไม่ได้จัดลำดับซ้ำ · ลำดับด้านล่างอ่านจากฐานข้อมูลจริง</div>}
      {params.error && (
        <div className="form-message error page-message">
          {ORDER_ERRORS[params.error] ?? `ดำเนินการไม่สำเร็จ (${params.error.slice(0, 60).replace(/[^a-z_]/g, "")})`} — ไม่มีรูปใดถูกย้าย
        </div>
      )}

      <nav className="public-gallery-filters" aria-label="หมวดผลงาน">
        <Link className={!active ? "active" : ""} href="/app/gallery/order">ทุกหมวด</Link>
        {categories.map((category) => (
          <Link
            className={active?.id === category.id ? "active" : ""}
            href={`/app/gallery/order?category=${encodeURIComponent(category.slug)}`}
            key={category.id}
          >
            {category.name}
            {category.status !== "ACTIVE" ? " (ซ่อน)" : ""}
          </Link>
        ))}
      </nav>

      <section className="app-panel cms-safety-note">
        <h2>ลำดับนี้ทำงานอย่างไร</h2>
        <p>
          เลขน้อยแสดงก่อน · จัดลำดับด้วยปุ่มขึ้น/ลง แล้วกดบันทึก ระบบจะให้เลขใหม่เป็น 10, 20, 30 ทั้งชุด
          เพื่อให้แทรกรูปเพิ่มภายหลังได้ และเพื่อไม่ให้มีเลขซ้ำกันอีก
        </p>
        <p>รูปที่ตั้งเป็นภาพเด่นจะยังขึ้นก่อนเสมอเมื่อฝังใน Section ของหน้าเว็บ ลำดับนี้คือลำดับของหน้าผลงานสาธารณะ</p>
        {tied > 0 && (
          <p>
            <b>ตอนนี้มี {tied} รูปที่ใช้เลขลำดับซ้ำกับรูปอื่น</b> ลำดับจึงยังไม่แน่นอน — กดบันทึกหนึ่งครั้งเพื่อให้เลขไม่ซ้ำกัน
          </p>
        )}
        <p>
          บันทึกครั้งเดียวทั้งหมวดในคำสั่งเดียว ถ้าไม่สำเร็จจะไม่มีรูปใดถูกย้ายเลย และหน้าจะโหลดลำดับจริงจากฐานข้อมูลให้ใหม่เสมอ
        </p>
        <p>จัดลำดับได้ทีละหมวดเท่านั้น เพราะระบบต้องได้รับลำดับครบทั้งหมวด ไม่รับลำดับบางส่วน</p>
      </section>

      {canWrite && !active && (
        <div className="form-message page-message" role="status">
          เลือกหมวดก่อนจึงจะจัดลำดับได้ — มุมมอง “ทุกหมวด” แสดงรูปจากหลายหมวดปนกัน จึงส่งลำดับครบทั้งหมวดไม่ได้
        </div>
      )}
      {canWrite && active && tooLarge && (
        <div className="form-message error page-message" role="status">
          หมวดนี้มีรูปสาธารณะมากกว่า {PAGE_SIZE} รูป ระบบจึงยังจัดลำดับให้ไม่ได้ในครั้งเดียว กรุณาแบ่งหมวดย่อยก่อน
        </div>
      )}

      <section className="detail-section">
        <div className="detail-section-head">
          <div>
            <p>PUBLIC ORDER</p>
            <h2>{active ? active.name : "ทุกหมวด"}</h2>
          </div>
          <span>{tooLarge ? `มากกว่า ${PAGE_SIZE} รูป` : `${items.length} รูป`}</span>
        </div>

        {items.length === 0 ? (
          <div className="app-panel app-empty">
            <div aria-hidden="true">🖼️</div>
            <h2>ยังไม่มีรูปสาธารณะที่เผยแพร่ในหมวดนี้</h2>
            <p>อัปโหลดและเผยแพร่รูปใน Media Library ก่อน จึงจะจัดลำดับได้</p>
            <div className="app-empty-actions">
              <Link href="/app/gallery">เปิด Media Library</Link>
            </div>
          </div>
        ) : canReorder && active ? (
          <GalleryOrderBoard items={items.map(toOrderItem)} categoryId={active.id} returnTo={returnTo} />
        ) : (
          <ol className="gallery-order-list">
            {items.map((item, position) => (
              <li className="app-panel gallery-order-row" key={item.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- private R2 thumbnails require the authorization-aware image route */}
                <img
                  src={`/api/gallery/images/${item.id}?role=thumbnail`}
                  alt={item.altText}
                  width={84}
                  height={63}
                  loading="lazy"
                  decoding="async"
                />
                <div className="gallery-order-meta">
                  <b>
                    {position + 1}. {item.title}
                  </b>
                  <small>
                    ลำดับ {item.sortOrder}
                    {item.isFeatured === 1 ? " · ภาพเด่น" : ""}
                  </small>
                </div>
                <span className="status-pill">{canWrite ? "จัดลำดับที่นี่ไม่ได้" : "ดูได้อย่างเดียว"}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

/**
 * One row, in the shape the reorder board submits.
 *
 * Only what the order endpoint needs and what the row displays. The endpoint
 * takes ids and a category, so the caption, location and job reference that the
 * per-item update had to carry are no longer travelling through the browser at
 * all — one fewer place for them to be dropped.
 */
function toOrderItem(item: {
  id: string;
  title: string;
  altText: string;
  sortOrder: number;
  isFeatured: number;
}): GalleryOrderItem {
  return {
    id: item.id,
    title: item.title,
    altText: item.altText,
    sortOrder: item.sortOrder,
    isFeatured: item.isFeatured === 1,
    thumbnailSrc: `/api/gallery/images/${encodeURIComponent(item.id)}?role=thumbnail`,
  };
}
