import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, galleryItems, motorcycles, posts, transportJobs } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireAdminActor } from "@/lib/admin-access";
import { JOB_STATUS_LABELS } from "@/lib/job-status";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const actor = await requireAdminActor("/admin");
  const db = getDb();
  const access = {
    jobs: can(actor, "jobs:read"),
    jobsWrite: can(actor, "jobs:write"),
    motorcycles: can(actor, "motorcycles:read"),
    site: can(actor, "site:read"),
    gallery: can(actor, "gallery:read"),
    companies: can(actor, "companies:read"),
  };

  const [jobCounts, motorcycleTotal, postTotal, publicGallery, companyTotal] = await Promise.all([
    access.jobs
      ? db.select({ status: transportJobs.status, total: count() }).from(transportJobs).groupBy(transportJobs.status).all()
      : Promise.resolve([]),
    access.motorcycles ? db.select({ total: count() }).from(motorcycles).get() : Promise.resolve(undefined),
    access.site ? db.select({ total: count() }).from(posts).get() : Promise.resolve(undefined),
    access.gallery
      ? db
          .select({ total: count() })
          .from(galleryItems)
          .where(and(eq(galleryItems.status, "PUBLISHED"), eq(galleryItems.visibility, "PUBLIC")))
          .get()
      : Promise.resolve(undefined),
    access.companies
      ? db.select({ total: count() }).from(companies).where(eq(companies.status, "ACTIVE")).get()
      : Promise.resolve(undefined),
  ]);

  const byStatus = new Map(jobCounts.map((row) => [row.status, Number(row.total)]));
  const jobTotal = jobCounts.reduce((sum, row) => sum + Number(row.total), 0);
  const activeJobs = (byStatus.get("OPEN") ?? 0) + (byStatus.get("IN_PROGRESS") ?? 0);

  const metrics = [
    access.jobs ? { label: "งานขนส่งทั้งหมด", value: jobTotal, note: `กำลังดูแล ${activeJobs} งาน`, href: "/admin/jobs", tone: "blue" } : null,
    access.motorcycles ? { label: "รถจักรยานยนต์", value: Number(motorcycleTotal?.total ?? 0), note: "ข้อมูลรถในระบบจริง", href: "/app/motorcycles", tone: "cyan" } : null,
    access.companies ? { label: "บริษัทลูกค้า", value: Number(companyTotal?.total ?? 0), note: "สถานะ ACTIVE", href: "/app/companies", tone: "amber" } : null,
    access.site ? { label: "ข่าวและบทความ", value: Number(postTotal?.total ?? 0), note: "รวมฉบับร่างและเผยแพร่", href: "/admin/posts", tone: "violet" } : null,
    access.gallery ? { label: "ผลงานสาธารณะ", value: Number(publicGallery?.total ?? 0), note: "PUBLISHED + PUBLIC", href: "/app/gallery", tone: "green" } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <>
      <section className="admin-page-hero">
        <div>
          <span className="admin-eyebrow">NATHEE OPERATIONS</span>
          <h1>ภาพรวมการดำเนินงาน</h1>
          <p>ข้อมูลบนหน้านี้อ่านจากฐานข้อมูลจริงตามสิทธิ์ของบัญชี และทุกการเปลี่ยนแปลงยังผ่านกฎฝั่งเซิร์ฟเวอร์เหมือนเดิม</p>
        </div>
        <div className="admin-hero-actions">
          {access.jobsWrite && <a className="admin-button primary" href="/admin/jobs#new-job">+ สร้างงานขนส่ง</a>}
          {access.site && <a className="admin-button" href="/admin/posts">จัดการข่าว</a>}
          <a className="admin-button subtle" href="/app">เปิดระบบเต็มรูปแบบ</a>
        </div>
      </section>

      <section className="admin-kpi-grid" aria-label="สรุปข้อมูลสำคัญ">
        {metrics.map((metric) => (
          <a className={`admin-kpi ${metric.tone}`} href={metric.href} key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value.toLocaleString("th-TH")}</strong>
            <small>{metric.note}</small>
            <i aria-hidden="true">↗</i>
          </a>
        ))}
      </section>

      <section className="admin-dashboard-grid">
        {access.jobs && (
          <article className="admin-card admin-status-card">
            <div className="admin-card-head">
              <div>
                <span className="admin-eyebrow">WORKLOAD</span>
                <h2>สถานะงานขนส่ง</h2>
              </div>
              <a href="/admin/jobs">ดูทั้งหมด</a>
            </div>
            <div className="admin-status-list">
              {(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED", "DRAFT"] as const).map((status) => (
                <div key={status}>
                  <span><i className={`admin-status-dot ${status}`} />{JOB_STATUS_LABELS[status]}</span>
                  <b>{byStatus.get(status) ?? 0}</b>
                </div>
              ))}
            </div>
          </article>
        )}

        <article className="admin-card admin-quick-card">
          <div className="admin-card-head">
            <div>
              <span className="admin-eyebrow">QUICK ACCESS</span>
              <h2>ทางลัดงานประจำวัน</h2>
            </div>
          </div>
          <div className="admin-quick-links">
            {access.jobs && <a href="/admin/jobs"><span>▣</span><b>งานขนส่ง</b><small>สร้างงาน แก้ไข เพิ่มรถ และติดตามสถานะ</small></a>}
            {access.motorcycles && <a href="/app/motorcycles"><span>◆</span><b>รถจักรยานยนต์</b><small>ค้นหา ตรวจสอบ และเปิดข้อมูลรถ</small></a>}
            {access.gallery && <a href="/app/gallery"><span>▥</span><b>Gallery / Portfolio</b><small>จัดการรูปผลงานจริงบนเว็บไซต์</small></a>}
            {access.site && <a href="/app/website"><span>✦</span><b>เว็บไซต์</b><small>หน้าเว็บ ข่าว ตั้งค่า และการเผยแพร่</small></a>}
            {actor.role === "OWNER" && <a href="/app/quotations"><span>▱</span><b>คำขอใบเสนอราคา</b><small>ติดตามคำขอจากหน้าเว็บสาธารณะ</small></a>}
            {can(actor, "audit:read") && <a href="/app/audit"><span>⌕</span><b>Audit Log</b><small>ตรวจสอบว่าใครเปลี่ยนอะไร เมื่อใด</small></a>}
          </div>
        </article>
      </section>

      <section className="admin-trust-strip">
        <span aria-hidden="true">✓</span>
        <div>
          <b>ไม่มีข้อมูลจำลองในหน้า Operations</b>
          <p>ตัวเลขอ่านจาก D1 จริง การบันทึกใช้ API เดิมที่ตรวจสิทธิ์และ Audit ฝั่งเซิร์ฟเวอร์</p>
        </div>
        {can(actor, "audit:read") && <a href="/app/audit">ตรวจสอบประวัติ</a>}
      </section>
    </>
  );
}
