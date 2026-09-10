import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, galleryItems, motorcycles, posts, transportJobs } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * The compact dashboard. Every number is a real count from D1 — no demo data,
 * no caching — so what the Owner sees here is what the business actually holds.
 */
export default async function AdminHomePage() {
  const db = getDb();
  const [jobCounts, motorcycleTotal, postTotal, publicGallery, companyTotal] = await Promise.all([
    db
      .select({ status: transportJobs.status, total: count() })
      .from(transportJobs)
      .groupBy(transportJobs.status)
      .all(),
    db.select({ total: count() }).from(motorcycles).get(),
    db.select({ total: count() }).from(posts).get(),
    db
      .select({ total: count() })
      .from(galleryItems)
      .where(and(eq(galleryItems.status, "PUBLISHED"), eq(galleryItems.visibility, "PUBLIC")))
      .get(),
    db.select({ total: count() }).from(companies).where(eq(companies.status, "ACTIVE")).get(),
  ]);

  const byStatus = new Map(jobCounts.map((row) => [row.status, Number(row.total)]));
  const jobTotal = jobCounts.reduce((sum, row) => sum + Number(row.total), 0);

  return (
    <>
      <div className="app-page-head">
        <div>
          <p>หลังบ้านแบบฟอร์มธรรมดา</p>
          <h1>หน้าหลัก</h1>
          <span>ทุกปุ่มเป็นฟอร์ม HTML แท้ ทำงานแม้ไม่มี JavaScript · ตัวเลขนับจากฐานข้อมูลจริงทั้งหมด</span>
        </div>
      </div>

      <section className="site-page-grid">
        <article className="app-panel">
          <span className="status-pill OPEN">{jobTotal}</span>
          <h2>งานขนส่งทั้งหมด</h2>
          <p>
            รอรับ {byStatus.get("OPEN") ?? 0} · กำลังดำเนินการ {byStatus.get("IN_PROGRESS") ?? 0} · เสร็จสิ้น{" "}
            {byStatus.get("COMPLETED") ?? 0} · ยกเลิก {byStatus.get("CANCELLED") ?? 0} · ร่าง{" "}
            {byStatus.get("DRAFT") ?? 0}
          </p>
          <div>
            { }
            <a className="button button-gradient" href="/admin/jobs">จัดการงานขนส่ง</a>
          </div>
        </article>
        <article className="app-panel">
          <span className="status-pill IN_PROGRESS">{Number(motorcycleTotal?.total ?? 0)}</span>
          <h2>รถจักรยานยนต์ในระบบ</h2>
          <p>เพิ่มรถได้จากหน้ารายละเอียดงาน</p>
        </article>
        <article className="app-panel">
          <span className="status-pill PUBLISHED">{Number(postTotal?.total ?? 0)}</span>
          <h2>ข่าวและบทความ</h2>
          <p>สร้าง และเผยแพร่ขึ้นหน้าเว็บจริงได้จากหน้าเดียว</p>
          <div>
            { }
            <a className="button button-gradient" href="/admin/posts">จัดการข่าว</a>
          </div>
        </article>
        <article className="app-panel">
          <span className="status-pill PUBLISH">{Number(publicGallery?.total ?? 0)}</span>
          <h2>รูปผลงานสาธารณะ</h2>
          <p>จัดการรูปเพิ่มได้ที่หลังบ้านเต็มรูปแบบ → Gallery</p>
        </article>
        <article className="app-panel">
          <span className="status-pill DRAFT">{Number(companyTotal?.total ?? 0)}</span>
          <h2>บริษัทลูกค้าที่ใช้งาน</h2>
          <p>เลือกได้เวลาสร้างงานใหม่</p>
        </article>
      </section>
    </>
  );
}
