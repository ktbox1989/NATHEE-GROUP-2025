import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { companies, motorcycles, transportJobs } from "@/db/schema";
import { allowedJobTransitions, JOB_STATUS_LABELS } from "@/lib/job-status";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  forbidden: "บัญชีนี้ไม่มีสิทธิ์แก้ไขงานของบริษัทนี้",
  locked: "งานจบแล้ว (เสร็จสิ้น/ยกเลิก) แก้ไขรายละเอียดไม่ได้",
  stale: "ข้อมูลถูกแก้จากที่อื่นก่อนหน้านี้ รีเฟรชแล้วลองใหม่อีกครั้ง",
  invalid_details: "กรอกข้อมูลไม่ถูกต้อง: จุดรับ/จุดส่ง (1-200 ตัวอักษร) และเหตุผลการแก้ไขอย่างน้อย 3 ตัวอักษร",
  invalid_schedule: "วันที่ไม่ถูกต้อง หรือกำหนดส่งมาก่อนวันรับ",
  invalid_transition: "เปลี่ยนสถานะนี้ไม่ได้จากสถานะปัจจุบัน",
  cancel_reason: "การยกเลิกต้องระบุเหตุผลอย่างน้อย 3 ตัวอักษร",
  no_motorcycles: "ปิดงานไม่ได้: งานนี้ยังไม่มีรถเลย",
  pending_motorcycles: "ปิดงานไม่ได้: ยังมีรที่ไม่ได้ส่งมอบ/ปิด",
  save_details: "บันทึกรายละเอียดไม่สำเร็จ ลองใหม่",
  save_status: "บันทึกสถานะไม่สำเร็จ ลองใหม่",
  job: "ไม่พบงานที่เลือก หรืองานจบแล้ว",
  validation: "ข้อมูลรถไม่ถูกต้อง: ต้องมีปีรถ สภาพ และหมายเลขตัวถังหรือเครื่องยนต์อย่างน้อยหนึ่งอย่าง",
  duplicate: "บันทึกรถไม่สำเร็จ (ข้อมูลซ้ำ) ลองตรวจหมายเลขตัวถัง/เครื่องยนต์",
};

const STATUSES: Record<string, string> = {
  details_updated: "บันทึกรายละเอียดงานแล้ว",
  status_updated: "เปลี่ยนสถานะงานแล้ว",
  unchanged: "ข้อมูลไม่มีอะไรเปลี่ยนแปลง",
  created: "เพิ่มรถเข้างานแล้ว งานเข้าสู่สถานะกำลังดำเนินงานอัตโนมัติ",
};

/**
 * One job, three native forms: edit the details, move the status along the
 * lifecycle the shared transition table allows, and add a motorcycle to the
 * job. Everything posts to the same audited endpoints the full back office
 * uses, with returnTo pointing back here.
 */
export default async function AdminJobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const db = getDb();
  const job = await db
    .select({
      id: transportJobs.id,
      jobNumber: transportJobs.jobNumber,
      companyName: companies.displayName,
      status: transportJobs.status,
      origin: transportJobs.origin,
      destination: transportJobs.destination,
      plannedPickupDate: transportJobs.plannedPickupDate,
      plannedDeliveryDate: transportJobs.plannedDeliveryDate,
      notes: transportJobs.notes,
      updatedAt: transportJobs.updatedAt,
    })
    .from(transportJobs)
    .innerJoin(companies, eq(companies.id, transportJobs.companyId))
    .where(eq(transportJobs.id, id))
    .get();
  if (!job) notFound();

  const bikes = await db
    .select({
      id: motorcycles.id,
      make: motorcycles.make,
      model: motorcycles.model,
      color: motorcycles.color,
      vin: motorcycles.vin,
      currentStatus: motorcycles.currentStatus,
    })
    .from(motorcycles)
    .where(eq(motorcycles.jobId, id))
    .orderBy(desc(motorcycles.createdAt), desc(motorcycles.id))
    .limit(100)
    .all();

  const editable = job.status !== "COMPLETED" && job.status !== "CANCELLED";
  const nextStatuses = allowedJobTransitions(job.status);
  const back = `/admin/jobs/${encodeURIComponent(id)}`;

  return (
    <>
      <div className="app-page-head">
        <div>
          <p>งานขนส่ง</p>
          <h1>{job.jobNumber}</h1>
          <span>
            {job.companyName} · {job.origin} → {job.destination} ·{" "}
            <span className={`status-pill ${job.status}`}>{JOB_STATUS_LABELS[job.status]}</span>
          </span>
        </div>
        { }
        <a className="button button-glass" href="/admin/jobs">กลับรายการงาน</a>
      </div>

      {query.error && <p className="form-error">{ERRORS[query.error] ?? "ดำเนินการไม่สำเร็จ"}</p>}
      {query.status && <p className="form-message">{STATUSES[query.status] ?? query.status}</p>}

      {editable && (
        <>
          <section className="app-panel">
            <h2>แก้ไขรายละเอียดงาน</h2>
            <form className="record-form" action={`/api/jobs/${encodeURIComponent(id)}`} method="post">
              <input type="hidden" name="returnTo" value={back} />
              <input type="hidden" name="expectedUpdatedAt" value={job.updatedAt} />
              <label className="field">
                <span>จุดรับรถ *</span>
                <input name="origin" required maxLength={200} defaultValue={job.origin} />
              </label>
              <label className="field">
                <span>จุดส่งรถ *</span>
                <input name="destination" required maxLength={200} defaultValue={job.destination} />
              </label>
              <label className="field">
                <span>วันที่รับรถ</span>
                <input type="date" name="plannedPickupDate" defaultValue={job.plannedPickupDate ?? ""} />
              </label>
              <label className="field">
                <span>กำหนดส่ง</span>
                <input type="date" name="plannedDeliveryDate" defaultValue={job.plannedDeliveryDate ?? ""} />
              </label>
              <label className="field full">
                <span>หมายเหตุงาน</span>
                <input name="notes" maxLength={2000} defaultValue={job.notes ?? ""} />
              </label>
              <label className="field full">
                <span>เหตุผลการแก้ไข * (อย่างน้อย 3 ตัวอักษร)</span>
                <input name="changeReason" required minLength={3} maxLength={500} placeholder="เช่น ลูกค้าเลื่อนวันรับรถ" />
              </label>
              <div className="full">
                <button type="submit" className="button button-gradient">บันทึกรายละเอียด</button>
              </div>
            </form>
          </section>

          {nextStatuses.length > 0 && (
            <section className="app-panel">
              <h2>เปลี่ยนสถานะงาน</h2>
              <p>สถานะปัจจุบัน: <b>{JOB_STATUS_LABELS[job.status]}</b> · ปิดงานเป็น “เสร็จสิ้น” ได้เมื่อรถทุกคันในงานส่งมอบแล้ว</p>
              <form className="record-form" action={`/api/jobs/${encodeURIComponent(id)}/status`} method="post">
                <input type="hidden" name="returnTo" value={back} />
                <input type="hidden" name="expectedUpdatedAt" value={job.updatedAt} />
                <label className="field">
                  <span>เปลี่ยนเป็น *</span>
                  <select name="newStatus" required defaultValue="">
                    <option value="" disabled>เลือกสถานะ</option>
                    {nextStatuses.map((status) => (
                      <option key={status} value={status}>{JOB_STATUS_LABELS[status]}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>หมายเหตุ (ยกเลิกต้องระบุเหตุผล)</span>
                  <input name="note" maxLength={1000} />
                </label>
                <div className="full">
                  <button type="submit" className="button button-gradient">อัปเดตสถานะ</button>
                </div>
              </form>
            </section>
          )}

          <section className="app-panel">
            <h2>เพิ่มรถจักรยานยนต์เข้างาน</h2>
            <p>เพิ่มรถคันแรกแล้วงานจะเข้าสู่สถานะกำลังดำเนินงานอัตโนมัติ</p>
            <form className="record-form" action="/api/motorcycles" method="post">
              <input type="hidden" name="returnTo" value={back} />
              <input type="hidden" name="jobId" value={id} />
              <label className="field">
                <span>ยี่ห้อ</span>
                <input name="make" maxLength={80} placeholder="เช่น Honda" />
              </label>
              <label className="field">
                <span>รุ่น</span>
                <input name="model" maxLength={80} placeholder="เช่น Wave 125i" />
              </label>
              <label className="field">
                <span>ปีรถ *</span>
                <input name="modelYear" required type="number" min={1900} max={2027} placeholder="2024" />
              </label>
              <label className="field">
                <span>สภาพ *</span>
                <select name="vehicleCondition" required defaultValue="UNKNOWN">
                  <option value="NEW">ใหม่</option>
                  <option value="USED">ใช้แล้ว</option>
                  <option value="UNKNOWN">ไม่ระบุ</option>
                </select>
              </label>
              <label className="field">
                <span>หมายเลขตัวถัง (VIN)</span>
                <input name="vin" maxLength={40} placeholder="ใส่ VIN หรือเลขเครื่องอย่างน้อยหนึ่งอย่าง" />
              </label>
              <label className="field">
                <span>หมายเลขเครื่องยนต์</span>
                <input name="engineNumber" maxLength={40} />
              </label>
              <label className="field">
                <span>สี</span>
                <input name="color" maxLength={40} />
              </label>
              <div className="full">
                <button type="submit" className="button button-gradient">เพิ่มรถเข้างาน</button>
              </div>
            </form>
          </section>
        </>
      )}

      <section className="app-panel">
        <h2>รถในงาน ({bikes.length} คัน)</h2>
        {bikes.length === 0 ? (
          <div className="app-empty">
            <h3>ยังไม่มีรถในงานนี้</h3>
            <p>{editable ? "เพิ่มรถจากแบบฟอร์มด้านบน" : "งานนี้ปิดไปแล้วโดยไม่มีรถ"}</p>
          </div>
        ) : (
          <div className="record-list">
            {bikes.map((bike) => (
              <article className="record-row" key={bike.id}>
                <b>{[bike.make, bike.model].filter(Boolean).join(" ") || "รถไม่ระบุรุ่น"}</b>
                <span>{bike.color || "—"}</span>
                <span>{bike.vin || "ไม่มีเลขตัวถัง"}</span>
                <span className={`status-pill ${bike.currentStatus}`}>{bike.currentStatus}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
