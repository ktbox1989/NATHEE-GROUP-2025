import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, transportJobs } from "@/db/schema";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid: "กรอกข้อมูลไม่ครบ: ต้องเลือกบริษัท จุดรับ และจุดส่ง",
  company: "บริษัทที่เลือกไม่พร้อมใช้งาน",
  save: "บันทึกไม่สำเร็จ กรุณาลองใหม่",
};

const STATUSES: Record<string, string> = {
  created: "สร้างงานใหม่เรียบร้อย สถานะเปิดงานรอรับรถ",
};

/**
 * The jobs list and the one-form job creator. Native form, server-built
 * options from the real companies table, redirect back here.
 */
export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const query = await searchParams;
  const db = getDb();
  const [jobs, companyRows] = await Promise.all([
    db
      .select({
        id: transportJobs.id,
        jobNumber: transportJobs.jobNumber,
        companyName: companies.displayName,
        origin: transportJobs.origin,
        destination: transportJobs.destination,
        status: transportJobs.status,
      })
      .from(transportJobs)
      .innerJoin(companies, eq(companies.id, transportJobs.companyId))
      .orderBy(desc(transportJobs.updatedAt), desc(transportJobs.id))
      .limit(50)
      .all(),
    db
      .select({ id: companies.id, name: companies.displayName })
      .from(companies)
      .where(eq(companies.status, "ACTIVE"))
      .orderBy(companies.displayName)
      .limit(100)
      .all(),
  ]);

  return (
    <>
      <div className="app-page-head">
        <div>
          <p>งานขนส่ง</p>
          <h1>รายการงาน</h1>
          <span>แสดง {jobs.length} รายการล่าสุด · คลิกเลขที่งานเพื่อดูรายละเอียด เพิ่มรถ และเปลี่ยนสถานะ</span>
        </div>
        { }
        <a className="button button-glass" href="/admin">กลับหน้าหลัก</a>
      </div>

      {query.error && <p className="form-error">{ERRORS[query.error] ?? "ดำเนินการไม่สำเร็จ"}</p>}
      {query.status && <p className="form-message">{STATUSES[query.status] ?? query.status}</p>}

      <section className="app-panel">
        <h2>สร้างงานขนส่งใหม่</h2>
        <form className="record-form" action="/api/jobs" method="post">
          <input type="hidden" name="returnTo" value="/admin/jobs" />
          <label className="field">
            <span>บริษัทลูกค้า *</span>
            <select name="companyId" required defaultValue="">
              <option value="" disabled>เลือกบริษัท</option>
              {companyRows.map((company) => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>จุดรับรถ *</span>
            <input name="origin" required maxLength={200} placeholder="เช่น ลานจอด บางนา" />
          </label>
          <label className="field">
            <span>จุดส่งรถ *</span>
            <input name="destination" required maxLength={200} placeholder="เช่น หนองคาย" />
          </label>
          <label className="field">
            <span>วันที่รับรถ (ถ้ารู้)</span>
            <input type="date" name="plannedPickupDate" />
          </label>
          <label className="field">
            <span>กำหนดส่ง (ถ้ารู้)</span>
            <input type="date" name="plannedDeliveryDate" />
          </label>
          <label className="field full">
            <span>หมายเหตุ</span>
            <input name="notes" maxLength={2000} />
          </label>
          <div className="full">
            <button type="submit" className="button button-gradient">สร้างงาน</button>
          </div>
        </form>
      </section>

      <section className="app-panel">
        <h2>งานล่าสุด</h2>
        {jobs.length === 0 ? (
          <div className="app-empty">
            <h3>ยังไม่มีงาน</h3>
            <p>สร้างงานแรกจากแบบฟอร์มด้านบน</p>
          </div>
        ) : (
          <div className="record-list">
            {jobs.map((job) => (
              <article className="record-row" key={job.id}>
                <a href={`/admin/jobs/${job.id}`}><b>{job.jobNumber}</b></a>
                <span>{job.companyName}</span>
                <span>{job.origin} → {job.destination}</span>
                <span className={`status-pill ${job.status}`}>{job.status}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
