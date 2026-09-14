import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, transportJobs } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireAdminPermission } from "@/lib/admin-access";
import { JOB_STATUS_LABELS } from "@/lib/job-status";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid: "กรอกข้อมูลไม่ครบ: ต้องเลือกบริษัท จุดรับ และจุดส่ง",
  company: "บริษัทที่เลือกไม่พร้อมใช้งาน",
  save: "บันทึกไม่สำเร็จ กรุณาลองใหม่",
};

const STATUSES: Record<string, string> = {
  created: "สร้างงานใหม่เรียบร้อย สถานะเปิดงานรอรับรถ",
};

export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const actor = await requireAdminPermission("jobs:read", "/admin/jobs");
  const query = await searchParams;
  const db = getDb();
  const canWrite = can(actor, "jobs:write");

  const [jobs, companyRows] = await Promise.all([
    db
      .select({
        id: transportJobs.id,
        jobNumber: transportJobs.jobNumber,
        companyName: companies.displayName,
        origin: transportJobs.origin,
        destination: transportJobs.destination,
        status: transportJobs.status,
        plannedPickupDate: transportJobs.plannedPickupDate,
        plannedDeliveryDate: transportJobs.plannedDeliveryDate,
      })
      .from(transportJobs)
      .innerJoin(companies, eq(companies.id, transportJobs.companyId))
      .orderBy(desc(transportJobs.updatedAt), desc(transportJobs.id))
      .limit(50)
      .all(),
    canWrite
      ? db
          .select({ id: companies.id, name: companies.displayName })
          .from(companies)
          .where(eq(companies.status, "ACTIVE"))
          .orderBy(companies.displayName)
          .limit(100)
          .all()
      : Promise.resolve([]),
  ]);

  return (
    <>
      <section className="admin-page-hero compact">
        <div>
          <span className="admin-eyebrow">TRANSPORT JOBS</span>
          <h1>งานขนส่ง</h1>
          <p>รายการ 50 งานล่าสุดจากฐานข้อมูลจริง เปิดแต่ละงานเพื่อแก้ไขรายละเอียด เพิ่มรถ และดำเนินสถานะตาม workflow ที่ระบบอนุญาต</p>
        </div>
        <div className="admin-hero-actions">
          {canWrite && <a className="admin-button primary" href="#new-job">+ สร้างงานใหม่</a>}
          <a className="admin-button" href="/app/jobs">มุมมองระบบเต็ม</a>
        </div>
      </section>

      {query.error && <p className="admin-alert error" role="alert">{ERRORS[query.error] ?? "ดำเนินการไม่สำเร็จ"}</p>}
      {query.status && <p className="admin-alert success" role="status">{STATUSES[query.status] ?? query.status}</p>}

      {canWrite && (
        <section className="admin-card admin-form-card" id="new-job">
          <div className="admin-card-head">
            <div>
              <span className="admin-eyebrow">NEW JOB</span>
              <h2>สร้างงานขนส่งใหม่</h2>
              <p>เลือกบริษัทและกำหนดเส้นทาง งานใหม่จะเริ่มที่สถานะเปิดงาน</p>
            </div>
          </div>
          <form className="admin-form-grid" action="/api/jobs" method="post">
            <input type="hidden" name="returnTo" value="/admin/jobs" />
            <label className="admin-field span-2">
              <span>บริษัทลูกค้า *</span>
              <select name="companyId" required defaultValue="">
                <option value="" disabled>เลือกบริษัทลูกค้า</option>
                {companyRows.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            </label>
            <label className="admin-field">
              <span>จุดรับรถ *</span>
              <input name="origin" required maxLength={200} placeholder="เช่น ลานจอด บางนา" />
            </label>
            <label className="admin-field">
              <span>จุดส่งรถ *</span>
              <input name="destination" required maxLength={200} placeholder="เช่น ศูนย์กระจายสินค้า เชียงใหม่" />
            </label>
            <label className="admin-field">
              <span>วันที่รับรถ</span>
              <input type="date" name="plannedPickupDate" />
            </label>
            <label className="admin-field">
              <span>กำหนดส่ง</span>
              <input type="date" name="plannedDeliveryDate" />
            </label>
            <label className="admin-field span-2">
              <span>หมายเหตุ</span>
              <textarea name="notes" maxLength={2000} rows={3} placeholder="รายละเอียดเพิ่มเติมของงาน (ถ้ามี)" />
            </label>
            <div className="admin-form-actions span-2">
              <button type="submit" className="admin-button primary">สร้างงานขนส่ง</button>
            </div>
          </form>
        </section>
      )}

      <section className="admin-card admin-list-card">
        <div className="admin-card-head">
          <div>
            <span className="admin-eyebrow">RECENT JOBS</span>
            <h2>งานล่าสุด</h2>
            <p>{jobs.length} รายการ · กดที่การ์ดเพื่อเปิดรายละเอียดงาน</p>
          </div>
        </div>

        {jobs.length === 0 ? (
          <div className="admin-empty">
            <span aria-hidden="true">▣</span>
            <h3>ยังไม่มีงานขนส่ง</h3>
            <p>{canWrite ? "เริ่มจากสร้างงานแรกด้านบน" : "ยังไม่มีรายการที่แสดงได้"}</p>
          </div>
        ) : (
          <div className="admin-job-list">
            {jobs.map((job) => (
              <a className="admin-job-row" href={`/admin/jobs/${job.id}`} key={job.id}>
                <span className="admin-job-number">{job.jobNumber}</span>
                <span className="admin-job-company">{job.companyName}</span>
                <span className="admin-job-route">
                  <b>{job.origin}</b>
                  <i aria-hidden="true">→</i>
                  <b>{job.destination}</b>
                </span>
                <span className="admin-job-dates">
                  {job.plannedPickupDate || "ไม่ระบุวันรับ"}
                  <i aria-hidden="true">→</i>
                  {job.plannedDeliveryDate || "ไม่ระบุกำหนดส่ง"}
                </span>
                <span className={`admin-status-pill ${job.status}`}>{JOB_STATUS_LABELS[job.status]}</span>
                <span className="admin-row-arrow" aria-hidden="true">›</span>
              </a>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
