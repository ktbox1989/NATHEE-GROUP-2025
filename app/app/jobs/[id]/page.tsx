/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- data table is horizontally scrollable on small screens */
import { and, asc, count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PendingForm, PendingSubmitButton } from "@/components/pending-form";
import { getDb } from "@/db";
import { auditLogs, companies, motorcycles, transportJobs } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import {
  allowedJobTransitions,
  JOB_STATUS_LABELS,
  parseJobStatus,
} from "@/lib/job-status";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
};

const MESSAGES: Record<string, string> = {
  details_updated: "อัปเดตรายละเอียดงานเรียบร้อยแล้ว",
  status_updated: "อัปเดตสถานะงานเรียบร้อยแล้ว",
  unchanged: "ข้อมูลเหมือนเดิม จึงไม่ได้สร้างการเปลี่ยนแปลงใหม่",
};

const ERRORS: Record<string, string> = {
  forbidden: "ไม่มีสิทธิ์แก้ไขงานนี้",
  locked: "งานที่เสร็จสิ้นหรือยกเลิกแล้วล็อกการแก้รายละเอียด",
  stale: "ข้อมูลถูกแก้จากอีกหน้าหนึ่งแล้ว กรุณาตรวจข้อมูลล่าสุดและลองใหม่",
  invalid_details: "รายละเอียดงานไม่ครบหรือยาวเกินกำหนด",
  invalid_schedule: "กำหนดการไม่ถูกต้อง วันที่ส่งต้องไม่ก่อนวันที่รับ",
  invalid_transition: "เปลี่ยนสถานะตามลำดับนี้ไม่ได้",
  cancel_reason: "การยกเลิกงานต้องระบุเหตุผลอย่างน้อย 3 ตัวอักษร",
  no_motorcycles: "ยังปิดงานไม่ได้ เพราะงานนี้ยังไม่มีรถ",
  pending_motorcycles: "ยังปิดงานไม่ได้ เพราะยังมีรถที่ไม่ถึงสถานะส่งมอบ/ปิด/ยกเลิก",
  save_details: "บันทึกรายละเอียดไม่สำเร็จ กรุณาลองใหม่",
  save_status: "บันทึกสถานะไม่สำเร็จ กรุณาลองใหม่",
};

export default async function JobDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const actor = await requireActor(`/app/jobs/${id}`);
  const db = getDb();
  const job = await db
    .select({
      id: transportJobs.id,
      jobNumber: transportJobs.jobNumber,
      companyId: transportJobs.companyId,
      companyName: companies.displayName,
      origin: transportJobs.origin,
      destination: transportJobs.destination,
      pickup: transportJobs.plannedPickupDate,
      delivery: transportJobs.plannedDeliveryDate,
      status: transportJobs.status,
      notes: transportJobs.notes,
      createdAt: transportJobs.createdAt,
      updatedAt: transportJobs.updatedAt,
    })
    .from(transportJobs)
    .innerJoin(companies, eq(companies.id, transportJobs.companyId))
    .where(eq(transportJobs.id, id))
    .get();

  if (!job || !can(actor, "jobs:read", job.companyId)) notFound();

  const [motorcycleRows, motorcycleCount, history] = await Promise.all([
    db.select({
      id: motorcycles.id,
      sequenceNumber: motorcycles.sequenceNumber,
      make: motorcycles.make,
      model: motorcycles.model,
      registration: motorcycles.registration,
      status: motorcycles.currentStatus,
    }).from(motorcycles).where(eq(motorcycles.jobId, id)).orderBy(asc(motorcycles.sequenceNumber)).limit(200).all(),
    db.select({ total: count() }).from(motorcycles).where(eq(motorcycles.jobId, id)).get(),
    db.select({
      action: auditLogs.action,
      beforeJson: auditLogs.beforeJson,
      afterJson: auditLogs.afterJson,
      reason: auditLogs.reason,
      createdAt: auditLogs.createdAt,
    }).from(auditLogs).where(and(eq(auditLogs.entityType, "transport_job"), eq(auditLogs.entityId, id))).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(30).all(),
  ]);

  const canWrite = can(actor, "jobs:write", job.companyId);
  const transitions = allowedJobTransitions(job.status);
  const locked = job.status === "COMPLETED" || job.status === "CANCELLED";
  const totalMotorcycles = Number(motorcycleCount?.total ?? 0);

  return (
    <>
      <div className="app-page-head">
        <div>
          <p>TRANSPORT JOB</p>
          <h1>{job.jobNumber}</h1>
          <span>{job.companyName} · {job.origin} → {job.destination}</span>
        </div>
        <div className="app-page-actions">
          {canWrite && <Link className="button button-glass" href={`/app/jobs/${job.id}/label`}>QR งาน</Link>}
          {canWrite && <Link className="button button-glass" href={`/app/jobs/${job.id}/labels`}>QR รถทั้งงาน</Link>}
          <Link className="button button-glass" href="/app/jobs">กลับรายการงาน</Link>
        </div>
      </div>

      {query.status && <div className="form-message success page-message">{MESSAGES[query.status] ?? query.status}</div>}
      {query.error && <div className="form-message error page-message">{ERRORS[query.error] ?? "ดำเนินการไม่สำเร็จ"}</div>}

      <div className="app-kpis">
        <article><b>{JOB_STATUS_LABELS[job.status]}</b><span>สถานะงาน</span></article>
        <article><b>{totalMotorcycles}</b><span>รถในงาน</span></article>
        <article><b>{job.pickup || "—"}</b><span>วันที่รับรถ</span></article>
        <article><b>{job.delivery || "—"}</b><span>กำหนดส่ง</span></article>
      </div>

      <section className="detail-section">
        <div className="detail-section-head">
          <div><p>JOB DETAILS</p><h2>รายละเอียดงาน</h2></div>
          <span>แก้ล่าสุด {new Date(job.updatedAt).toLocaleString("th-TH")}</span>
        </div>
        {!canWrite || locked ? (
          <article className="app-panel">
            <p><b>เส้นทาง:</b> {job.origin} → {job.destination}</p>
            <p><b>กำหนดการ:</b> รับ {job.pickup || "ไม่ระบุ"} · ส่ง {job.delivery || "ไม่ระบุ"}</p>
            <p><b>หมายเหตุ:</b> {job.notes || "ไม่มีหมายเหตุ"}</p>
            {locked && <small>งานสถานะ {JOB_STATUS_LABELS[job.status]} ถูกล็อกเพื่อรักษาประวัติการปฏิบัติงาน</small>}
          </article>
        ) : (
          <PendingForm className="record-form app-panel" action={`/api/jobs/${job.id}`} busyMessage="กำลังบันทึกรายละเอียดงาน…">
            <input type="hidden" name="expectedUpdatedAt" value={job.updatedAt} />
            <div className="field"><label htmlFor="origin">จุดรับรถ *</label><input id="origin" name="origin" defaultValue={job.origin} maxLength={200} required /></div>
            <div className="field"><label htmlFor="destination">จุดส่งรถ *</label><input id="destination" name="destination" defaultValue={job.destination} maxLength={200} required /></div>
            <div className="field"><label htmlFor="plannedPickupDate">วันที่รับรถ</label><input id="plannedPickupDate" name="plannedPickupDate" type="date" defaultValue={job.pickup ?? ""} /></div>
            <div className="field"><label htmlFor="plannedDeliveryDate">วันที่ส่งโดยประมาณ</label><input id="plannedDeliveryDate" name="plannedDeliveryDate" type="date" defaultValue={job.delivery ?? ""} /></div>
            <div className="field full"><label htmlFor="notes">หมายเหตุงาน</label><textarea id="notes" name="notes" rows={3} maxLength={2000} defaultValue={job.notes ?? ""} /></div>
            <div className="field full"><label htmlFor="changeReason">เหตุผลการแก้ไข *</label><input id="changeReason" name="changeReason" minLength={3} maxLength={500} required placeholder="เช่น ลูกค้าเลื่อนวันรับรถ" /></div>
            <div className="full"><PendingSubmitButton className="button button-gradient" busyLabel="กำลังบันทึก…">บันทึกรายละเอียดงาน</PendingSubmitButton></div>
          </PendingForm>
        )}
      </section>

      <section className="detail-section">
        <div className="detail-section-head"><div><p>WORKFLOW</p><h2>อัปเดตสถานะงาน</h2></div></div>
        <article className="app-panel">
          <p>สถานะปัจจุบัน <span className={`status-pill ${job.status}`}>{JOB_STATUS_LABELS[job.status]}</span></p>
          {canWrite && transitions.length > 0 ? (
            <PendingForm className="record-form" action={`/api/jobs/${job.id}/status`} busyMessage="กำลังยืนยันสถานะงาน…">
              <input type="hidden" name="expectedUpdatedAt" value={job.updatedAt} />
              <div className="field">
                <label htmlFor="newStatus">เปลี่ยนเป็น *</label>
                <select id="newStatus" name="newStatus" required defaultValue="">
                  <option value="" disabled>เลือกสถานะถัดไป</option>
                  {transitions.map((status) => <option key={status} value={status}>{JOB_STATUS_LABELS[status]}</option>)}
                </select>
              </div>
              <div className="field full">
                <label htmlFor="statusNote">หมายเหตุ</label>
                <textarea id="statusNote" name="note" rows={3} maxLength={1000} placeholder="ยกเลิกงานต้องระบุเหตุผลอย่างน้อย 3 ตัวอักษร" />
              </div>
              <div className="full">
                <small>การปิดเป็น “เสร็จสิ้น” จะตรวจรถทุกคันในงานก่อน และปฏิเสธถ้ายังมีรถค้างระหว่างดำเนินการ</small>
              </div>
              <div className="full"><PendingSubmitButton className="button button-gradient" busyLabel="กำลังอัปเดต…">อัปเดตสถานะงาน</PendingSubmitButton></div>
            </PendingForm>
          ) : (
            <p>{locked ? "งานอยู่ในสถานะปลายทางแล้ว จึงไม่มีสถานะถัดไป" : "บัญชีนี้ดูสถานะได้ แต่ไม่มีสิทธิ์แก้ไข"}</p>
          )}
        </article>
      </section>

      <section className="detail-section">
        <div className="detail-section-head">
          <div><p>MOTORCYCLES</p><h2>รถในงาน</h2></div>
          <span>แสดง {motorcycleRows.length} จาก {totalMotorcycles} คัน</span>
        </div>
        {motorcycleRows.length ? (
          <div className="data-table-wrap" tabIndex={0} role="region" aria-label="รถจักรยานยนต์ในงาน">
            <table className="data-table">
              <thead><tr><th>ลำดับ</th><th>รถ</th><th>ทะเบียน</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
              <tbody>{motorcycleRows.map((motorcycle) => (
                <tr key={motorcycle.id}>
                  <td>{motorcycle.sequenceNumber}</td>
                  <td>{[motorcycle.make, motorcycle.model].filter(Boolean).join(" ") || "ไม่ระบุรุ่น"}</td>
                  <td>{motorcycle.registration || "—"}</td>
                  <td><span className={`status-pill ${motorcycle.status}`}>{motorcycle.status}</span></td>
                  <td><Link href={`/app/motorcycles/${motorcycle.id}`}>เปิดรายละเอียดรถ</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <div className="app-panel app-empty"><h2>ยังไม่มีรถในงานนี้</h2><p>เพิ่มรถจากเมนูรถจักรยานยนต์ แล้วงานจะเข้าสู่สถานะกำลังดำเนินงานอัตโนมัติ</p></div>
        )}
      </section>

      <section className="detail-section">
        <div className="detail-section-head"><div><p>AUDIT</p><h2>ประวัติการแก้ไขงาน</h2></div><span>ล่าสุด {history.length} รายการ</span></div>
        <div className="cms-revision-list">
          {history.map((event, index) => {
            const beforeStatus = statusFromJson(event.beforeJson);
            const afterStatus = statusFromJson(event.afterJson);
            return (
              <article className="app-panel" key={`${event.createdAt}-${index}`}>
                <b>{auditLabel(event.action)}</b>
                {beforeStatus && afterStatus && <p>{JOB_STATUS_LABELS[beforeStatus]} → {JOB_STATUS_LABELS[afterStatus]}</p>}
                {event.reason && <p>{event.reason}</p>}
                <small>{new Date(event.createdAt).toLocaleString("th-TH")}</small>
              </article>
            );
          })}
          {history.length === 0 && <div className="app-panel app-empty"><p>ยังไม่มีประวัติ Audit ของงานนี้</p></div>}
        </div>
      </section>
    </>
  );
}

function statusFromJson(value: string | null) {
  if (!value) return null;
  try {
    const status = (JSON.parse(value) as { status?: unknown }).status;
    return typeof status === "string" ? parseJobStatus(status) : null;
  } catch {
    return null;
  }
}

function auditLabel(action: string) {
  if (action === "CREATE") return "เปิดงาน";
  if (action === "STATUS_CHANGE") return "เปลี่ยนสถานะ";
  if (action === "UPDATE") return "แก้รายละเอียด";
  return action;
}
