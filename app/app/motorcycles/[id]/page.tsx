/* eslint-disable @next/next/no-img-element -- Private R2 images are served by an authenticated endpoint and must not pass through the public image optimizer. */
import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { companies, motorcycleImages, motorcycles, statusEvents, transportJobs, users } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { motorcycleStatusLabels } from "@/lib/labels";
import { allowedTransitions } from "@/lib/status-transitions";

export const dynamic = "force-dynamic";

type MotorcycleDetailProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
};

export default async function MotorcycleDetailPage({ params, searchParams }: MotorcycleDetailProps) {
  const { id } = await params;
  const query = await searchParams;
  const actor = await requireActor(`/app/motorcycles/${id}`);
  const db = getDb();
  const customerScope = actor.role === "CUSTOMER" && actor.companyId
    ? eq(motorcycles.companyId, actor.companyId)
    : undefined;
  const record = await db
    .select({
      id: motorcycles.id,
      publicId: motorcycles.publicId,
      companyId: motorcycles.companyId,
      companyName: companies.displayName,
      jobNumber: transportJobs.jobNumber,
      sequenceNumber: motorcycles.sequenceNumber,
      make: motorcycles.make,
      model: motorcycles.model,
      color: motorcycles.color,
      registration: motorcycles.registration,
      vin: motorcycles.vin,
      engineNumber: motorcycles.engineNumber,
      currentStatus: motorcycles.currentStatus,
    })
    .from(motorcycles)
    .innerJoin(companies, eq(companies.id, motorcycles.companyId))
    .innerJoin(transportJobs, eq(transportJobs.id, motorcycles.jobId))
    .where(and(eq(motorcycles.id, id), customerScope))
    .get();
  if (!record) notFound();
  if (!can(actor, "motorcycles:read", record.companyId)) redirect("/app");

  const [images, events] = await Promise.all([
    db
      .select()
      .from(motorcycleImages)
      .where(eq(motorcycleImages.motorcycleId, id))
      .orderBy(desc(motorcycleImages.createdAt))
      .all(),
    db
      .select({
        id: statusEvents.id,
        previousStatus: statusEvents.previousStatus,
        newStatus: statusEvents.newStatus,
        note: statusEvents.note,
        createdAt: statusEvents.createdAt,
        actorName: users.displayName,
      })
      .from(statusEvents)
      .innerJoin(users, eq(users.id, statusEvents.createdBy))
      .where(eq(statusEvents.motorcycleId, id))
      .orderBy(asc(statusEvents.createdAt))
      .all(),
  ]);
  const nextStatuses = allowedTransitions(record.currentStatus);
  const canUpdateStatus = can(actor, "status:write", record.companyId);
  const canUpload = can(actor, "images:write", record.companyId);

  return (
    <>
      <div className="app-page-head">
        <div><p>{record.jobNumber}</p><h1>รถคันที่ {record.sequenceNumber}</h1><span>{record.companyName}</span></div>
        <div className="app-page-actions"><Link href="/app/motorcycles">← กลับรายการรถ</Link></div>
      </div>
      {query.status === "updated" && <div className="form-message success page-message">อัปเดตสถานะเรียบร้อยแล้ว</div>}
      {query.status === "image_uploaded" && <div className="form-message success page-message">อัปโหลดรูปเรียบร้อยแล้ว</div>}
      {query.error && <div className="form-message error page-message">บันทึกไม่สำเร็จ กรุณาตรวจสอบข้อมูลและสิทธิ์</div>}

      <div className="record-detail-grid">
        <section className="app-panel record-summary">
          <div className="record-summary-head"><span>ข้อมูลรถ</span><span className="status-pill">{motorcycleStatusLabels[record.currentStatus]}</span></div>
          <dl>
            <div><dt>ยี่ห้อ / รุ่น</dt><dd>{[record.make, record.model].filter(Boolean).join(" · ") || "—"}</dd></div>
            <div><dt>สี</dt><dd>{record.color || "—"}</dd></div>
            <div><dt>ทะเบียน</dt><dd>{record.registration || "—"}</dd></div>
            <div><dt>VIN</dt><dd>{record.vin || "—"}</dd></div>
            <div><dt>เลขเครื่อง</dt><dd>{record.engineNumber || "—"}</dd></div>
            <div><dt>Public ID</dt><dd className="mono-value">{record.publicId}</dd></div>
          </dl>
        </section>

        {canUpdateStatus && nextStatuses.length > 0 && (
          <form className="app-panel status-form" action={`/api/motorcycles/${id}/status`} method="post">
            <h2>เปลี่ยนสถานะ</h2>
            <div className="field"><label htmlFor="newStatus">สถานะใหม่</label><select id="newStatus" name="newStatus" required><option value="">เลือกสถานะ</option>{nextStatuses.map((status) => <option key={status} value={status}>{motorcycleStatusLabels[status]}</option>)}</select></div>
            <div className="field"><label htmlFor="note">หมายเหตุ / เหตุผล</label><textarea id="note" name="note" rows={3} maxLength={1000} /></div>
            <button className="button button-gradient" type="submit">บันทึกสถานะ</button>
          </form>
        )}
      </div>

      <section className="detail-section">
        <div className="detail-section-head"><div><p>IMAGES</p><h2>รูปภาพรถ</h2></div></div>
        {canUpload && (
          <form className="record-form upload-form" action={`/api/motorcycles/${id}/images`} method="post" encType="multipart/form-data">
            <div className="field"><label htmlFor="category">ประเภทภาพ</label><select id="category" name="category"><option value="FRONT">ด้านหน้า</option><option value="REAR">ด้านหลัง</option><option value="LEFT">ด้านซ้าย</option><option value="RIGHT">ด้านขวา</option><option value="DAMAGE">ตำหนิ / ความเสียหาย</option><option value="DELIVERY">ส่งมอบ</option><option value="OTHER">อื่นๆ</option></select></div>
            <div className="field"><label htmlFor="image">เลือกรูป (ไม่เกิน 10 MB)</label><input id="image" name="image" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" required /></div>
            <div className="full"><button className="button button-gradient" type="submit">อัปโหลดรูป</button></div>
          </form>
        )}
        {images.length ? <div className="image-grid">{images.map((image) => (
          <figure key={image.id}><img src={`/api/images/${image.id}`} alt={`ภาพ ${image.category} ของรถคันที่ ${record.sequenceNumber}`} loading="lazy" /><figcaption><b>{image.category}</b><span>{formatThaiDateTime(image.createdAt)}</span></figcaption></figure>
        ))}</div> : <div className="app-panel app-empty"><div>📷</div><h2>ยังไม่มีรูปภาพ</h2><p>พนักงานสามารถอัปโหลดรูปจากมือถือได้โดยตรง</p></div>}
      </section>

      <section className="detail-section">
        <div className="detail-section-head"><div><p>TIMELINE</p><h2>ประวัติสถานะ</h2></div></div>
        <ol className="timeline">{events.map((event) => (
          <li key={event.id}><span className="timeline-dot" /><div><b>{motorcycleStatusLabels[event.newStatus]}</b><p>{event.note || "ไม่มีหมายเหตุ"}</p><small>{formatThaiDateTime(event.createdAt)} · {event.actorName}</small></div></li>
        ))}</ol>
      </section>
    </>
  );
}

function formatThaiDateTime(value: string): string {
  const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(date);
}
