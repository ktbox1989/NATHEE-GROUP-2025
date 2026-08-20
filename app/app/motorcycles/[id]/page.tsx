/* eslint-disable @next/next/no-img-element -- Private R2 images are served by an authenticated endpoint and must not pass through the public image optimizer. */
import Link from "next/link";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { companies, motorcycleImages, motorcycles, statusEvents, transportJobs, tripMotorcycleAssignments, trips, trucks, users, yardPlacements, yardZones } from "@/db/schema";
import { can, isCustomerRole, isInternalRole } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { motorcycleStatusLabels } from "@/lib/labels";
import { allowedTransitions } from "@/lib/status-transitions";
import { isYardPlacementAllowed, YARD_EXIT_VALUE } from "@/lib/yard";

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
  const customerScope = isCustomerRole(actor.role) && actor.companyId
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

  const canReadYard = can(actor, "yard:read");
  const canUpdateYard = can(actor, "yard:write");
  const [images, events, currentYard, activeZones, activeTrip] = await Promise.all([
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
    canReadYard
      ? db
          .select({
            placementId: yardPlacements.id,
            yardZoneId: yardPlacements.yardZoneId,
            zoneCode: yardZones.code,
            zoneName: yardZones.name,
            enteredAt: yardPlacements.enteredAt,
            note: yardPlacements.note,
          })
          .from(yardPlacements)
          .innerJoin(yardZones, eq(yardZones.id, yardPlacements.yardZoneId))
          .where(and(eq(yardPlacements.motorcycleId, id), isNull(yardPlacements.exitedAt)))
          .get()
      : Promise.resolve(undefined),
    canUpdateYard
      ? db
          .select({ id: yardZones.id, code: yardZones.code, name: yardZones.name })
          .from(yardZones)
          .where(eq(yardZones.status, "ACTIVE"))
          .orderBy(asc(yardZones.code))
          .all()
      : Promise.resolve([]),
    isInternalRole(actor.role) && can(actor, "jobs:read")
      ? db
          .select({
            assignmentState: tripMotorcycleAssignments.state,
            tripId: trips.id,
            tripNumber: trips.tripNumber,
            tripStatus: trips.status,
            origin: trips.origin,
            destination: trips.destination,
            truckCode: trucks.code,
          })
          .from(tripMotorcycleAssignments)
          .innerJoin(trips, eq(trips.id, tripMotorcycleAssignments.tripId))
          .innerJoin(trucks, eq(trucks.id, trips.truckId))
          .where(and(eq(tripMotorcycleAssignments.motorcycleId, id), isNull(tripMotorcycleAssignments.releasedAt)))
          .get()
      : Promise.resolve(undefined),
  ]);
  const nextStatuses = allowedTransitions(record.currentStatus);
  const canUpdateStatus = can(actor, "status:write", record.companyId);
  const canUpload = can(actor, "images:write", record.companyId);
  const canPrintLabel = can(actor, "motorcycles:write", record.companyId);

  return (
    <>
      <div className="app-page-head">
        <div><p>{record.jobNumber}</p><h1>รถคันที่ {record.sequenceNumber}</h1><span>{record.companyName}</span></div>
        <div className="app-page-actions"><Link href="/app/motorcycles">← กลับรายการรถ</Link>{canPrintLabel && <Link href={`/app/motorcycles/${record.id}/label`}>พิมพ์ฉลาก QR</Link>}</div>
      </div>

      {activeTrip && (
        <section className="detail-section">
          <div className="detail-section-head"><div><p>ACTIVE TRIP</p><h2>เที่ยวที่รถคันนี้สังกัดอยู่</h2></div><Link href={`/app/trips/${activeTrip.tripId}`}>เปิด Load Board →</Link></div>
          <article className="app-panel motorcycle-trip-context">
            <div><span>{activeTrip.tripNumber} · {activeTrip.truckCode}</span><h3>{activeTrip.origin} → {activeTrip.destination}</h3></div>
            <dl><div><dt>สถานะเที่ยว</dt><dd>{tripStatusLabel(activeTrip.tripStatus)}</dd></div><div><dt>สถานะบนเที่ยว</dt><dd>{assignmentStateLabel(activeTrip.assignmentState)}</dd></div></dl>
            <p>การเปลี่ยนสถานะรถในหน้านี้จะไม่เปลี่ยนสถานะเที่ยวอัตโนมัติ ให้กลับไปยืนยันขึ้น/ลงรถที่ Load Board เพื่อคง Audit ครบทั้งสองส่วน</p>
          </article>
        </section>
      )}
      {query.status === "updated" && <div className="form-message success page-message">อัปเดตสถานะเรียบร้อยแล้ว</div>}
      {query.status === "image_uploaded" && <div className="form-message success page-message">อัปโหลดรูปเรียบร้อยแล้ว</div>}
      {query.status === "yard_updated" && <div className="form-message success page-message">อัปเดตตำแหน่งลานเรียบร้อยแล้ว</div>}
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

      {canReadYard && (
        <section className="detail-section">
          <div className="detail-section-head"><div><p>YARD LOCATION</p><h2>ตำแหน่งในลาน</h2></div><Link href="/app/yard">เปิดภาพรวมลาน →</Link></div>
          <div className="record-detail-grid">
            <article className="app-panel yard-current-card">
              <span>ตำแหน่งปัจจุบัน</span>
              {currentYard ? <><h3>{currentYard.zoneCode} · {currentYard.zoneName}</h3><p>เข้าพื้นที่ {formatThaiDateTime(currentYard.enteredAt)}</p><small>{currentYard.note || "ไม่มีหมายเหตุ"}</small></> : <><h3>อยู่นอกลาน</h3><p>ยังไม่มีตำแหน่งลานที่ active</p></>}
            </article>
            {canUpdateYard && (
              <div className="yard-action-stack">
                {activeZones.some((zone) => zone.id !== currentYard?.yardZoneId) && isYardPlacementAllowed(record.currentStatus) ? (
                  <form className="app-panel status-form yard-form" action={`/api/motorcycles/${id}/yard`} method="post">
                    <h2>{currentYard ? "ย้ายโซน" : "นำรถเข้าลาน"}</h2>
                    <input type="hidden" name="expectedPlacementId" value={currentYard?.placementId ?? "none"} />
                    <input type="hidden" name="requestKey" value={crypto.randomUUID()} />
                    <div className="field"><label htmlFor="destinationZoneId">โซนปลายทาง</label><select id="destinationZoneId" name="destinationZoneId" required><option value="">เลือกโซน</option>{activeZones.filter((zone) => zone.id !== currentYard?.yardZoneId).map((zone) => <option key={zone.id} value={zone.id}>{zone.code} · {zone.name}</option>)}</select></div>
                    <div className="field"><label htmlFor="yardNote">หมายเหตุ</label><textarea id="yardNote" name="note" rows={2} maxLength={500} /></div>
                    <button className="button button-gradient" type="submit">บันทึกตำแหน่ง</button>
                  </form>
                ) : !isYardPlacementAllowed(record.currentStatus) ? (
                  <div className="app-panel yard-action-note">สถานะรถปัจจุบันไม่อนุญาตให้นำเข้าหรือย้ายลาน</div>
                ) : (
                  <div className="app-panel yard-action-note">ยังไม่มีโซน active อื่นสำหรับบันทึกตำแหน่ง</div>
                )}
                {currentYard && (
                  <form className="app-panel yard-exit-form" action={`/api/motorcycles/${id}/yard`} method="post">
                    <input type="hidden" name="destinationZoneId" value={YARD_EXIT_VALUE} />
                    <input type="hidden" name="expectedPlacementId" value={currentYard.placementId} />
                    <input type="hidden" name="requestKey" value={crypto.randomUUID()} />
                    <div className="field"><label htmlFor="yardExitNote">หมายเหตุนำออกจากลาน</label><input id="yardExitNote" name="note" maxLength={500} /></div>
                    <button className="button button-glass" type="submit">บันทึกออกจากลาน</button>
                  </form>
                )}
              </div>
            )}
          </div>
        </section>
      )}

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

function tripStatusLabel(status: string): string {
  return ({ DRAFT: "ร่าง", PLANNED: "วางแผนแล้ว", LOADING: "กำลังขึ้นรถ", IN_TRANSIT: "กำลังขนส่ง", ARRIVED: "ถึงปลายทาง", COMPLETED: "เสร็จสิ้น", CANCELLED: "ยกเลิก" } as Record<string, string>)[status] ?? status;
}

function assignmentStateLabel(state: string): string {
  return ({ ASSIGNED: "จัดเข้าเที่ยวแล้ว", LOADED: "ยืนยันขึ้นรถแล้ว", UNLOADED: "ยืนยันลงรถแล้ว", RELEASED: "ปิดรายการแล้ว" } as Record<string, string>)[state] ?? state;
}
