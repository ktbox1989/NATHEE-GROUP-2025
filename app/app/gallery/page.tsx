import Link from "next/link";
/* eslint-disable @next/next/no-img-element -- private R2 thumbnails require the authorization-aware image route */
import { and, desc, eq, lt, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { GalleryBulkUploadForm } from "@/components/gallery-bulk-upload-form";
import { getDb } from "@/db";
import { companies, galleryCategories, galleryItems, transportJobs } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { GALLERY_ADMIN_PAGE_SIZE } from "@/lib/gallery";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ status?: string; error?: string; before?: string; beforeId?: string }> };

export default async function GalleryAdminPage({ searchParams }: Props) {
  const actor = await requireActor("/app/gallery");
  if (!can(actor, "gallery:read")) redirect("/app");
  const params = await searchParams;
  const cursor = validCursor(params.before, params.beforeId) ? { createdAt: params.before!, id: params.beforeId! } : null;
  const db = getDb();
  const [categories, jobs, rows] = await Promise.all([
    db.select().from(galleryCategories).orderBy(galleryCategories.sortOrder, galleryCategories.name).all(),
    db.select({ id: transportJobs.id, companyId: transportJobs.companyId, jobNumber: transportJobs.jobNumber, companyName: companies.displayName }).from(transportJobs).innerJoin(companies, eq(companies.id, transportJobs.companyId)).orderBy(desc(transportJobs.createdAt)).limit(200).all(),
    db.select().from(galleryItems).where(cursor ? or(lt(galleryItems.createdAt, cursor.createdAt), and(eq(galleryItems.createdAt, cursor.createdAt), lt(galleryItems.id, cursor.id))) : undefined).orderBy(desc(galleryItems.createdAt), desc(galleryItems.id)).limit(GALLERY_ADMIN_PAGE_SIZE + 1).all(),
  ]);
  const hasMore = rows.length > GALLERY_ADMIN_PAGE_SIZE;
  const items = rows.slice(0, GALLERY_ADMIN_PAGE_SIZE);
  const next = items.at(-1);
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));
  const canWrite = can(actor, "gallery:write");
  const canPublish = can(actor, "gallery:publish");

  return <>
    <div className="app-page-head"><div><p>MEDIA LIBRARY</p><h1>Gallery / Portfolio</h1><span>จัดการภาพจริง คำบรรยาย สิทธิ์การมองเห็น และสถานะเผยแพร่ โดยไม่ปะปนกับหลักฐานงานลูกค้า</span></div></div>
    {params.status && <div className="form-message success page-message">บันทึก Gallery เรียบร้อยแล้ว</div>}
    {params.error && <div className="form-message error page-message">ดำเนินการไม่สำเร็จ ({params.error}) กรุณาตรวจข้อมูลและสิทธิ์</div>}

    {canWrite && <section className="detail-section"><div className="detail-section-head"><div><p>CATEGORIES</p><h2>หมวดผลงาน</h2></div></div>
      <form className="record-form" action="/api/gallery/categories" method="post"><div className="field"><label htmlFor="category-name">ชื่อหมวด *</label><input id="category-name" name="name" maxLength={120} required /></div><div className="field"><label htmlFor="category-slug">Slug ภาษาอังกฤษ *</label><input id="category-slug" name="slug" pattern="[a-z0-9-]{2,80}" required placeholder="domestic-transport" /></div><div className="field"><label htmlFor="category-order">ลำดับ</label><input id="category-order" name="sortOrder" type="number" min={0} max={1000000} defaultValue={0} /></div><div className="field full"><label htmlFor="category-description">คำอธิบาย</label><input id="category-description" name="description" maxLength={500} /></div><div className="full"><button className="button button-gradient" type="submit">เพิ่มหมวด</button></div></form>
      <div className="gallery-category-admin">{categories.map((category) => <form key={category.id} action={`/api/gallery/categories/${category.id}`} method="post" className="app-panel"><input name="name" defaultValue={category.name} maxLength={120} required aria-label="ชื่อหมวด" /><input name="slug" defaultValue={category.slug} pattern="[a-z0-9-]{2,80}" required aria-label="Slug" /><input name="description" defaultValue={category.description ?? ""} maxLength={500} aria-label="คำอธิบาย" /><input name="sortOrder" type="number" min={0} max={1000000} defaultValue={category.sortOrder} aria-label="ลำดับ" /><select name="status" defaultValue={category.status} aria-label="สถานะหมวด"><option value="ACTIVE">แสดง</option><option value="HIDDEN">ซ่อน</option></select><button type="submit">บันทึกหมวด</button></form>)}</div>
    </section>}

    {canWrite && <section className="detail-section"><div className="detail-section-head"><div><p>BULK UPLOAD</p><h2>เพิ่มภาพจริงหลายภาพ</h2></div><span>ครั้งละไม่เกิน 20 ภาพ · อัปโหลดเป็น Draft เสมอ</span></div>{categories.some((category) => category.status === "ACTIVE") ? <GalleryBulkUploadForm categories={categories.filter((category) => category.status === "ACTIVE").map(({ id, name }) => ({ id, name }))} jobs={jobs.map((job) => ({ id: job.id, companyId: job.companyId, label: `${job.jobNumber} · ${job.companyName}` }))} /> : <div className="app-panel app-empty"><h2>สร้างหมวดก่อนอัปโหลด</h2><p>Gallery จะไม่รับภาพที่ไม่มีหมวด</p></div>}</section>}

    <section className="detail-section"><div className="detail-section-head"><div><p>LIBRARY</p><h2>รายการภาพ</h2></div><span>{items.length} รายการในหน้านี้</span></div>
      <div className="gallery-admin-grid">{items.map((item) => <article className="app-panel gallery-admin-card" id={item.id} key={item.id}><img src={`/api/gallery/images/${item.id}?role=thumbnail`} alt={item.altText} loading="lazy" width={640} height={480} /><div className="gallery-admin-meta"><div><span className={`status-pill ${item.status}`}>{item.status}</span>{item.isFeatured === 1 && <span className="status-pill">FEATURED</span>}</div><h3>{item.title}</h3><p>{categoryMap.get(item.categoryId) ?? "ไม่พบหมวด"} · {item.visibility}</p>{item.caption && <small>{item.caption}</small>}</div>
        {canWrite && <form className="gallery-item-form" action={`/api/gallery/${item.id}`} method="post"><input type="hidden" name="action" value="UPDATE" /><input type="hidden" name="companyId" value={item.companyId ?? ""} /><input type="hidden" name="jobId" value={item.jobId ?? ""} /><label>ชื่อภาพ<input name="title" defaultValue={item.title} maxLength={160} required /></label><label>Alt text<input name="altText" defaultValue={item.altText} maxLength={300} required /></label><label>คำบรรยาย<textarea name="caption" defaultValue={item.caption ?? ""} maxLength={1000} rows={2} /></label><label>วันที่ถ่าย<input name="takenAt" type="date" defaultValue={item.takenAt ?? ""} /></label><label>สถานที่<input name="location" defaultValue={item.location ?? ""} maxLength={200} /></label><label>Job reference สาธารณะ<input name="publicJobReference" defaultValue={item.publicJobReference ?? ""} maxLength={100} /></label><label>หมวด<select name="categoryId" defaultValue={item.categoryId}>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label>การมองเห็น<select name="visibility" defaultValue={item.visibility}><option value="PUBLIC">สาธารณะ</option><option value="INTERNAL">ภายใน</option>{item.visibility === "CUSTOMER_JOB" && <option value="CUSTOMER_JOB">ลูกค้าเจ้าของงาน</option>}</select></label><label>ลำดับ<input name="sortOrder" type="number" min={0} max={1000000} defaultValue={item.sortOrder} /></label><button type="submit">บันทึกรายละเอียด</button></form>}
        <div className="gallery-admin-actions">{canPublish && item.status !== "PUBLISHED" && item.status !== "ARCHIVED" && <Action id={item.id} value="PUBLISH" label={item.visibility === "PUBLIC" ? "เผยแพร่สาธารณะ" : "เผยแพร่ตามสิทธิ์"} />}{canPublish && item.status === "PUBLISHED" && <Action id={item.id} value="HIDE" label="ซ่อน" />}{canPublish && item.status === "PUBLISHED" && item.visibility === "PUBLIC" && <Action id={item.id} value={item.isFeatured ? "UNFEATURE" : "FEATURE"} label={item.isFeatured ? "ยกเลิก Featured" : "เลือก Featured"} />}{canWrite && item.status !== "ARCHIVED" && <Action id={item.id} value="ARCHIVE" label="ลบออกจากการใช้งาน (Archive)" />}</div>
      </article>)}</div>
      {!items.length && <div className="app-panel app-empty"><div>🖼️</div><h2>ยังไม่มีภาพ</h2><p>ระบบจะไม่ใช้ภาพ Stock แทนผลงานจริง</p></div>}
      <nav className="batch-navigation" aria-label="หน้ารายการ Gallery"><span>สูงสุด {GALLERY_ADMIN_PAGE_SIZE} รายการต่อหน้า</span>{hasMore && next && <Link className="button button-glass" href={`/app/gallery?before=${encodeURIComponent(next.createdAt)}&beforeId=${encodeURIComponent(next.id)}`}>หน้าถัดไป →</Link>}</nav>
    </section>
  </>;
}

function Action({ id, value, label }: { id: string; value: string; label: string }) { return <form action={`/api/gallery/${id}`} method="post"><input type="hidden" name="action" value={value} /><button type="submit">{label}</button></form>; }
function validCursor(date: string | undefined, id: string | undefined) { return Boolean(date && id && date.length <= 40 && id.length <= 100 && !Number.isNaN(Date.parse(date))); }
