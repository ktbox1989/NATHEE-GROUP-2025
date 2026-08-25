import Link from "next/link";
/* eslint-disable @next/next/no-img-element -- private R2 thumbnails require the authorization-aware image route */
import { and, asc, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
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
const PAGE_SIZE = 60;

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
    .limit(PAGE_SIZE)
    .all();

  const canWrite = can(actor, "gallery:write");
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

      {params.status && <div className="form-message success page-message">บันทึกลำดับแล้ว</div>}
      {params.error && <div className="form-message error page-message">ดำเนินการไม่สำเร็จ ({params.error})</div>}

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
        <h2>เลขลำดับทำงานอย่างไร</h2>
        <p>
          เลขน้อยแสดงก่อน · รูปที่ตั้งเป็นภาพเด่นจะขึ้นก่อนเสมอเมื่อฝังใน Section ของหน้าเว็บ ·
          ถ้าเลขซ้ำกัน ระบบจะเรียงรูปที่อัปโหลดใหม่กว่าขึ้นก่อน แนะนำให้เว้นเลขเป็น 10, 20, 30 เพื่อแทรกรูปได้ภายหลัง
        </p>
        {tied > 0 && <p><b>ตอนนี้มี {tied} รูปที่ใช้เลขลำดับซ้ำกับรูปอื่น</b> จึงยังจัดลำดับได้ไม่แน่นอน</p>}
        <p>บันทึกแล้วระบบจะพากลับไปหน้า Media Library พร้อมเลื่อนไปที่รูปนั้น</p>
      </section>

      <section className="detail-section">
        <div className="detail-section-head">
          <div>
            <p>PUBLIC ORDER</p>
            <h2>{active ? active.name : "ทุกหมวด"}</h2>
          </div>
          <span>{items.length} รูป{items.length === PAGE_SIZE ? ` (แสดงสูงสุด ${PAGE_SIZE})` : ""}</span>
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
        ) : (
          <ol className="gallery-order-list">
            {items.map((item, position) => (
              <li className="app-panel gallery-order-row" key={item.id}>
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
                    เลขลำดับปัจจุบัน {item.sortOrder}
                    {item.isFeatured === 1 ? " · ภาพเด่น" : ""}
                  </small>
                </div>
                {canWrite ? (
                  <form className="gallery-order-actions" action={`/api/gallery/${item.id}`} method="post">
                    <input type="hidden" name="action" value="UPDATE" />
                    <input type="hidden" name="title" value={item.title} />
                    <input type="hidden" name="altText" value={item.altText} />
                    <input type="hidden" name="caption" value={item.caption ?? ""} />
                    <input type="hidden" name="takenAt" value={item.takenAt ?? ""} />
                    <input type="hidden" name="location" value={item.location ?? ""} />
                    <input type="hidden" name="publicJobReference" value={item.publicJobReference ?? ""} />
                    <input type="hidden" name="categoryId" value={item.categoryId} />
                    <input type="hidden" name="visibility" value={item.visibility} />
                    <input type="hidden" name="companyId" value={item.companyId ?? ""} />
                    <input type="hidden" name="jobId" value={item.jobId ?? ""} />
                    <label className="sr-only" htmlFor={`order-${item.id}`}>
                      เลขลำดับของ {item.title}
                    </label>
                    <input
                      id={`order-${item.id}`}
                      name="sortOrder"
                      type="number"
                      min={0}
                      max={1000000}
                      defaultValue={item.sortOrder}
                      inputMode="numeric"
                    />
                    <button type="submit">บันทึกลำดับ</button>
                  </form>
                ) : (
                  <span className="status-pill">ดูได้อย่างเดียว</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
