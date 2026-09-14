import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { companies, motorcycles, transportJobs } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireAdminPermission } from "@/lib/admin-access";
import { allowedJobTransitions, JOB_STATUS_LABELS } from "@/lib/job-status";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  forbidden: "บัญชีนี้ไม่มีสิทธิ์ดำเนินการกับข้อมูลนี้",
  locked: "งานจบแล้ว (เสร็จสิ้น/ยกเลิก) แก้ไขรายละเอียดไม่ได้",
  stale: "ข้อมูลถูกแก้จากที่อื่นก่อนหน้านี้ รีเฟรชแล้วลองใหม่อีกครั้ง",
  invalid_details: "กรอกข้อมูลไม่ถูกต้อง: จุดรับ/จุดส่ง และเหตุผลการแก้ไขอย่างน้อย 3 ตัวอักษร",
  invalid_schedule: "วันที่ไม่ถูกต้อง หรือกำหนดส่งมาก่อนวันรับ",
  invalid_transition: "เปลี่ยนสถานะนี้ไม่ได้จากสถานะปัจจุบัน",
  cancel_reason: "การยกเลิกต้องระบุเหตุผลอย่างน้อย 3 ตัวอักษร",
  no_motorcycles: "ปิดงานไม่ได้: งานนี้ยังไม่มีรถ",
  pending_motorcycles: "ปิดงานไม่ได้: ยังมีรถที่ไม่ได้ส่งมอบ/ปิด",
  save_details: "บันทึกรายละเอียดไม่สำเร็จ ลองใหม่",
  save_status: "บันทึกสถานะไม่สำเร็จ ลองใหม่",
  job: "ไม่พบงานที่เลือก หรืองานจบแล้ว",
  validation: "ข้อมูลรถไม่ถูกต้อง: ต้องมีปีรถ สภาพ และหมายเลขตัวถังหรือเครื่องยนต์อย่างน้อยหนึ่งอย่าง",
  duplicate: "บันทึกรถไม่สำเร็จ ข้อมูล VIN หรือเลขเครื่องอาจซ้ำ",
};

const STATUSES: Record<string, string> = {
  details_updated: "บันทึกรายละเอียดงานแล้ว",
  status_updated: "เปลี่ยนสถานะงานแล้ว",
  unchanged: "ข้อมูลไม่มีอะไรเปลี่ยนแปลง",
  created: "เพิ่มรถเข้างานแล้ว งานเข้าสู่สถานะกำลังดำเนินงานอัตโนมัติ",
};

export default async function AdminJobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const actor = await requireAdminPermission("jobs:read", "/admin/jobs");
  const { id } = await params;
  const query = await searchParams;
  const db = getDb();
  const job = await db
    .select({
      id: transportJobs.id,
      jobNumber: transportJobs.jobNumber,
      companyId: transportJobs.companyId,
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

  const canWriteJob = can(actor, "jobs:write", job.companyId);
  const canReadMotorcycles = can(actor, "motorcycles:read", job.companyId);
  const canAddMotorcycle = can(actor, "motorcycles:write", job.companyId);
  const lifecycleOpen = job.status !== "COMPLETED" && job.status !== "CANCELLED";
  const editable = lifecycleOpen && canWriteJob;
  const nextStatuses = canWriteJob ? allowedJobTransitions(job.status) : [];
  const back = `/admin/jobs/${encodeURIComponent(id)}`;

  const bikes = canReadMotorcycles
    ? await db
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
        .all()
    : [];

  return (
    <>
      <section className="admin-page-hero compact admin-job-hero">
        <div>
          <span className="admin-eyebrow">JOB DETAIL</span>
          <h1>{job.jobNumber}</h1>
          <p>{job.companyName}</p>
          <div className="admin-route-line">
            <b>{job.origin}</b><span aria-hidden="true">→</span><b>{job.destination}</b>
          </div>
        </div>
        <div className="admin-hero-actions stacked">
          <span className={`admin-status-pill large ${job.status}`}>{JOB_STATUS_LABELS[job.status]}</span>
          <a className="admin-button" href="/admin/jobs">← กลับรายการงาน</a>
        </div>
      </section>

      {query.error && <p className="admin-alert error" role="alert">{ERRORS[query.error] ?? "ดำเนินการไม่สำเร็จ"}</p>}
      {query.status && <p className="admin-alert success" role="status">{STATUSES[query.status] ?? query.status}</p>}

      <section className="admin-job-summary">
        <article><span>วันที่รับรถ</span><b>{job.plannedPickupDate || "ยังไม่ระบุ"}</b></article>
        <article><span>กำหนดส่ง</span><b>{job.plannedDeliveryDate || "ยังไม่ระบุ"}</b></article>
        <article><span>รถในงาน</span><b>{canReadMotorcycles ? `${bikes.length} คัน` : "ไม่มีสิทธิ์ดู"}</b></article>
        <article><span>สถานะ</span><b>{JOB_STATUS_LABELS[job.status]}</b></article>
      </section>

      {editable && (
        <section className="admin-card admin-form-card">
          <div className="admin-card-head">
            <div>
              <span className="admin-eyebrow">JOB DETAILS</span>
              <h2>แก้ไขรายละเอียดงาน</h2>
              <p>ทุกการแก้ไขต้องมีเหตุผลและใช้ optimistic lock ป้องกันการเขียนทับข้อมูลที่เพิ่งเปลี่ยน</p>
            </div>
          </div>
          <form className="admin-form-grid" action={`/api/jobs/${encodeURIComponent(id)}`} method="post">
            <input type="hidden" name="returnTo" value={back} />
            <input type="hidden" name="expectedUpdatedAt" value={job.updatedAt} />
            <label className="admin-field">
              <span>จุดรับรถ *</span>
              <input name="origin" required maxLength={200} defaultValue={job.origin} />
            </label>
            <label className="admin-field">
              <span>จุดส่งรถ *</span>
              <input name="destination" required maxLength={200} defaultValue={job.destination} />
            </label>
            <label className="admin-field">
              <span>วันที่รับรถ</span>
              <input type="date" name="plannedPickupDate" defaultValue={job.plannedPickupDate ?? ""} />
            </label>
            <label className="admin-field">
              <span>กำหนดส่ง</span>
              <input type="date" name="plannedDeliveryDate" defaultValue={job.plannedDeliveryDate ?? ""} />
            </label>
            <label className="admin-field span-2">
              <span>หมายเหตุงาน</span>
              <textarea name="notes" rows={3} maxLength={2000} defaultValue={job.notes ?? ""} />
            </label>
            <label className="admin-field span-2">
              <span>เหตุผลการแก้ไข *</span>
              <input name="changeReason" required minLength={3} maxLength={500} placeholder="เช่น ลูกค้าเลื่อนวันรับรถ" />
              <small>เหตุผลนี้ถูกเก็บใน Audit Log</small>
            </label>
            <div className="admin-form-actions span-2">
              <button type="submit" className="admin-button primary">บันทึกรายละเอียด</button>
            </div>
          </form>
        </section>
      )}

      {nextStatuses.length > 0 && (
        <section className="admin-card admin-form-card">
          <div className="admin-card-head">
            <div>
              <span className="admin-eyebrow">LIFECYCLE</span>
              <h2>เปลี่ยนสถานะงาน</h2>
              <p>ระบบอนุญาตเฉพาะ transition ที่ถูกต้อง และปิดงานเป็น “เสร็จสิ้น” ได้เมื่อรถทุกคันพร้อมตามกฎจริง</p>
            </div>
          </div>
          <form className="admin-form-grid compact-grid" action={`/api/jobs/${encodeURIComponent(id)}/status`} method="post">
            <input type="hidden" name="returnTo" value={back} />
            <input type="hidden" name="expectedUpdatedAt" value={job.updatedAt} />
            <label className="admin-field">
              <span>สถานะใหม่ *</span>
              <select name="newStatus" required defaultValue="">
                <option value="" disabled>เลือกสถานะ</option>
                {nextStatuses.map((status) => <option key={status} value={status}>{JOB_STATUS_LABELS[status]}</option>)}
              </select>
            </label>
            <label className="admin-field">
              <span>หมายเหตุ</span>
              <input name="note" maxLength={1000} placeholder="ยกเลิกต้องระบุเหตุผล" />
            </label>
            <div className="admin-form-actions span-2">
              <button type="submit" className="admin-button primary">อัปเดตสถานะ</button>
            </div>
          </form>
        </section>
      )}

      {lifecycleOpen && canAddMotorcycle && (
        <section className="admin-card admin-form-card">
          <div className="admin-card-head">
            <div>
              <span className="admin-eyebrow">MOTORCYCLE INTAKE</span>
              <h2>เพิ่มรถจักรยานยนต์เข้างาน</h2>
              <p>เพิ่มรถคันแรกแล้วงานจะเข้าสู่สถานะกำลังดำเนินงานอัตโนมัติตาม endpoint เดิม</p>
            </div>
          </div>
          <form className="admin-form-grid" action="/api/motorcycles" method="post">
            <input type="hidden" name="returnTo" value={back} />
            <input type="hidden" name="jobId" value={id} />
            <label className="admin-field">
              <span>ยี่ห้อ</span>
              <input name="make" maxLength={80} placeholder="เช่น Honda" />
            </label>
            <label className="admin-field">
              <span>รุ่น</span>
              <input name="model" maxLength={80} placeholder="เช่น Wave 125i" />
            </label>
            <label className="admin-field">
              <span>ปีรถ *</span>
              <input name="modelYear" required type="number" min={1900} max={2027} placeholder="2024" />
            </label>
            <label className="admin-field">
              <span>สภาพ *</span>
              <select name="vehicleCondition" required defaultValue="UNKNOWN">
                <option value="NEW">ใหม่</option>
                <option value="USED">ใช้แล้ว</option>
                <option value="UNKNOWN">ไม่ระบุ</option>
              </select>
            </label>
            <label className="admin-field">
              <span>หมายเลขตัวถัง (VIN)</span>
              <input name="vin" maxLength={40} placeholder="ใส่ VIN หรือเลขเครื่องอย่างน้อยหนึ่งอย่าง" />
            </label>
            <label className="admin-field">
              <span>หมายเลขเครื่องยนต์</span>
              <input name="engineNumber" maxLength={40} />
            </label>
            <label className="admin-field">
              <span>สี</span>
              <input name="color" maxLength={40} />
            </label>
            <div className="admin-form-actions span-2">
              <button type="submit" className="admin-button primary">เพิ่มรถเข้างาน</button>
            </div>
          </form>
        </section>
      )}

      <section className="admin-card admin-list-card">
        <div className="admin-card-head">
          <div>
            <span className="admin-eyebrow">MOTORCYCLES</span>
            <h2>รถในงาน {canReadMotorcycles ? `(${bikes.length} คัน)` : ""}</h2>
            <p>{canReadMotorcycles ? "ข้อมูลรถที่ผูกกับงานนี้" : "บัญชีนี้ไม่มีสิทธิ์อ่านข้อมูลรถในงาน"}</p>
          </div>
          {canReadMotorcycles && <a href="/app/motorcycles">เปิดทะเบียนรถทั้งหมด</a>}
        </div>
        {!canReadMotorcycles ? (
          <div className="admin-empty compact">
            <span aria-hidden="true">⌾</span>
            <h3>จำกัดตามสิทธิ์</h3>
            <p>ระบบไม่ได้อ่านรายการรถจากฐานข้อมูลสำหรับบัญชีนี้</p>
          </div>
        ) : bikes.length === 0 ? (
          <div className="admin-empty">
            <span aria-hidden="true">◆</span>
            <h3>ยังไม่มีรถในงานนี้</h3>
            <p>{lifecycleOpen && canAddMotorcycle ? "เพิ่มรถจากแบบฟอร์มด้านบน" : "งานนี้ยังไม่มีข้อมูลรถ"}</p>
          </div>
        ) : (
          <div className="admin-bike-grid">
            {bikes.map((bike) => (
              <article className="admin-bike-card" key={bike.id}>
                <div>
                  <span className="admin-eyebrow">MOTORCYCLE</span>
                  <h3>{[bike.make, bike.model].filter(Boolean).join(" ") || "รถไม่ระบุรุ่น"}</h3>
                </div>
                <dl>
                  <div><dt>สี</dt><dd>{bike.color || "—"}</dd></div>
                  <div><dt>VIN</dt><dd>{bike.vin || "ไม่มีเลขตัวถัง"}</dd></div>
                </dl>
                <span className={`admin-status-pill ${bike.currentStatus}`}>{bike.currentStatus}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
