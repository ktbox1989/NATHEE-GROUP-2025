/* eslint-disable @next/next/no-img-element -- Private R2 images are served by an authenticated endpoint and must not pass through the public image optimizer. */
import Link from "next/link";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import {
  companies,
  containerMotorcycleAssignments,
  inspectionFindings,
  motorcycleImages,
  motorcycleInspections,
  motorcycles,
  proofOfDeliveryRecords,
  shippingContainers,
  statusEvents,
  transportJobs,
  tripMotorcycleAssignments,
  trips,
  trucks,
  users,
  yardPlacements,
  yardZones,
  FUEL_LEVELS,
  INSPECTION_RESULTS,
  INSPECTION_TYPES,
} from "@/db/schema";
import { can, isCustomerRole, isInternalRole } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { inspectionTypeAllowedForStatus, maskPhone } from "@/lib/inspections";
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
  const canReadInspection = can(actor, "status:read", record.companyId);
  const canReadDocuments = can(actor, "documents:read", record.companyId);
  const [images, events, currentYard, activeZones, activeTrip, activeContainer, inspections, findings, podRecords] = await Promise.all([
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
      .limit(100)
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
    isInternalRole(actor.role) && can(actor, "jobs:read")
      ? db
          .select({
            assignmentState: containerMotorcycleAssignments.state,
            containerId: shippingContainers.id,
            containerNumber: shippingContainers.containerNumber,
            containerStatus: shippingContainers.status,
            port: shippingContainers.port,
            country: shippingContainers.country,
            sealNumber: shippingContainers.sealNumber,
          })
          .from(containerMotorcycleAssignments)
          .innerJoin(shippingContainers, eq(shippingContainers.id, containerMotorcycleAssignments.containerId))
          .where(and(eq(containerMotorcycleAssignments.motorcycleId, id), isNull(containerMotorcycleAssignments.releasedAt)))
          .get()
      : Promise.resolve(undefined),
    canReadInspection
      ? db
          .select({
            id: motorcycleInspections.id,
            type: motorcycleInspections.type,
            result: motorcycleInspections.result,
            odometerKm: motorcycleInspections.odometerKm,
            fuelLevel: motorcycleInspections.fuelLevel,
            notes: motorcycleInspections.notes,
            inspectedAt: motorcycleInspections.inspectedAt,
            inspectorName: users.displayName,
          })
          .from(motorcycleInspections)
          .innerJoin(users, eq(users.id, motorcycleInspections.inspectedBy))
          .where(eq(motorcycleInspections.motorcycleId, id))
          .orderBy(desc(motorcycleInspections.inspectedAt), desc(motorcycleInspections.id))
          .limit(50)
          .all()
      : Promise.resolve([]),
    canReadInspection
      ? db
          .select({
            id: inspectionFindings.id,
            inspectionId: inspectionFindings.inspectionId,
            area: inspectionFindings.area,
            severity: inspectionFindings.severity,
            description: inspectionFindings.description,
            evidenceImageId: inspectionFindings.evidenceImageId,
            createdAt: inspectionFindings.createdAt,
          })
          .from(inspectionFindings)
          .innerJoin(motorcycleInspections, eq(motorcycleInspections.id, inspectionFindings.inspectionId))
          .where(eq(motorcycleInspections.motorcycleId, id))
          .orderBy(desc(inspectionFindings.createdAt), desc(inspectionFindings.id))
          .limit(100)
          .all()
      : Promise.resolve([]),
    canReadDocuments
      ? db
          .select({
            id: proofOfDeliveryRecords.id,
            recipientName: proofOfDeliveryRecords.recipientName,
            recipientPhone: proofOfDeliveryRecords.recipientPhone,
            deliveryLocation: proofOfDeliveryRecords.deliveryLocation,
            deliveredAt: proofOfDeliveryRecords.deliveredAt,
            evidenceImageId: proofOfDeliveryRecords.evidenceImageId,
            notes: proofOfDeliveryRecords.notes,
            status: proofOfDeliveryRecords.status,
            voidReason: proofOfDeliveryRecords.voidReason,
            createdAt: proofOfDeliveryRecords.createdAt,
            receiverName: users.displayName,
          })
          .from(proofOfDeliveryRecords)
          .innerJoin(users, eq(users.id, proofOfDeliveryRecords.receivedBy))
          .where(eq(proofOfDeliveryRecords.motorcycleId, id))
          .orderBy(desc(proofOfDeliveryRecords.createdAt), desc(proofOfDeliveryRecords.id))
          .limit(20)
          .all()
      : Promise.resolve([]),
  ]);
  const canUpdateStatus = can(actor, "status:write", record.companyId);
  const canUpload = can(actor, "images:write", record.companyId);
  const canPrintLabel = can(actor, "motorcycles:write", record.companyId);
  const canInspect = canUpdateStatus;
  const canManagePod = isInternalRole(actor.role) && canUpdateStatus && can(actor, "images:read", record.companyId);
  const activePod = podRecords.find((pod) => pod.status === "ACTIVE");
  const hasPassedReceiptInspection = inspections.some((inspection) => inspection.type === "RECEIPT" && inspection.result === "PASS");
  const nextStatuses = allowedTransitions(record.currentStatus).filter((status) => {
    if (status === "INSPECTED") return hasPassedReceiptInspection;
    if (status === "DELIVERED") return Boolean(activePod);
    return true;
  });
  const damageImages = images.filter((image) => image.category === "DAMAGE");
  const deliveryImages = images.filter((image) => image.category === "DELIVERY");
  const allowedInspectionTypes = INSPECTION_TYPES.filter((type) => inspectionTypeAllowedForStatus(type, record.currentStatus));

  return (
    <>
      <div className="app-page-head">
        <div><p>{record.jobNumber}</p><h1>รถคันที่ {record.sequenceNumber}</h1><span>{record.companyName}</span></div>
        <div className="app-page-actions"><Link href="/app/motorcycles">← กลับรายการรถ</Link>{canReadDocuments && <Link href={`/app/motorcycles/${record.id}/documents`}>เอกสาร / PDF</Link>}{canPrintLabel && <Link href={`/app/motorcycles/${record.id}/label`}>พิมพ์ฉลาก QR</Link>}</div>
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
      {activeContainer && (
        <section className="detail-section">
          <div className="detail-section-head"><div><p>ACTIVE CONTAINER</p><h2>ตู้ที่รถคันนี้สังกัดอยู่</h2></div><Link href={`/app/containers/${activeContainer.containerId}`}>เปิด Load Manifest →</Link></div>
          <article className="app-panel motorcycle-trip-context">
            <div><span>{activeContainer.containerNumber} · Seal {activeContainer.sealNumber || "ยังไม่ระบุ"}</span><h3>{activeContainer.port} → {activeContainer.country}</h3></div>
            <dl><div><dt>สถานะตู้</dt><dd>{containerStatusLabel(activeContainer.containerStatus)}</dd></div><div><dt>สถานะในตู้</dt><dd>{containerAssignmentStateLabel(activeContainer.assignmentState)}</dd></div></dl>
            <p>สถานะรถและสถานะ Load Manifest ถูกตรวจแยกกัน เพื่อให้การโหลด/นำลงมี Audit ครบและไม่เกิดการข้ามขั้นตอน</p>
          </article>
        </section>
      )}
      {query.status === "updated" && <div className="form-message success page-message">อัปเดตสถานะเรียบร้อยแล้ว</div>}
      {query.status === "image_uploaded" && <div className="form-message success page-message">อัปโหลดรูปเรียบร้อยแล้ว</div>}
      {query.status === "yard_updated" && <div className="form-message success page-message">อัปเดตตำแหน่งลานเรียบร้อยแล้ว</div>}
      {query.status === "inspection_created" && <div className="form-message success page-message">บันทึกผลตรวจสภาพและ Audit แล้ว</div>}
      {query.status === "inspection_exists" && <div className="login-notice page-message">คำขอนี้บันทึกผลตรวจแล้ว ระบบไม่สร้างข้อมูลซ้ำ</div>}
      {query.status === "finding_created" && <div className="form-message success page-message">เพิ่มรายการความเสียหายแล้ว</div>}
      {query.status === "finding_exists" && <div className="login-notice page-message">คำขอนี้เพิ่มรายการความเสียหายแล้ว</div>}
      {query.status === "pod_created" && <div className="form-message success page-message">บันทึกหลักฐานส่งมอบแล้ว</div>}
      {query.status === "pod_exists" && <div className="login-notice page-message">คำขอนี้บันทึกหลักฐานส่งมอบแล้ว</div>}
      {query.status === "pod_voided" && <div className="form-message success page-message">ยกเลิกหลักฐานฉบับเดิมโดยเก็บประวัติแล้ว</div>}
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

      {canUpdateStatus && allowedTransitions(record.currentStatus).includes("INSPECTED") && !hasPassedReceiptInspection && <div className="login-notice page-message">ต้องบันทึกผลตรวจรับรถเป็น “ผ่าน” ก่อน ระบบจึงจะอนุญาตสถานะตรวจสภาพแล้ว</div>}
      {canUpdateStatus && allowedTransitions(record.currentStatus).includes("DELIVERED") && !activePod && <div className="login-notice page-message">ต้องมีหลักฐานส่งมอบที่ active พร้อมรูป DELIVERY ก่อน ระบบจึงจะอนุญาตสถานะส่งมอบแล้ว</div>}

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
          <figure key={image.id}><img src={`/api/images/${image.id}`} alt={`ภาพ ${image.category} ของรถคันที่ ${record.sequenceNumber}`} width={640} height={480} loading="lazy" decoding="async" sizes="(max-width: 600px) calc(100vw - 28px), (max-width: 940px) 48vw, 31vw" /><figcaption><b>{image.category}</b><span>{formatThaiDateTime(image.createdAt)}</span></figcaption></figure>
        ))}</div> : <div className="app-panel app-empty"><div>📷</div><h2>ยังไม่มีรูปภาพ</h2><p>พนักงานสามารถอัปโหลดรูปจากมือถือได้โดยตรง</p></div>}
      </section>

      {canReadInspection && (
        <section className="detail-section">
          <div className="detail-section-head"><div><p>INSPECTION & DAMAGE</p><h2>ตรวจสภาพและรายการความเสียหาย</h2></div><span>ล่าสุด 50 ใบตรวจ · 100 รายการตรวจพบ</span></div>
          {canInspect && allowedInspectionTypes.length > 0 && (
            <form className="record-form inspection-form" action={`/api/motorcycles/${id}/inspections`} method="post">
              <input type="hidden" name="requestKey" value={crypto.randomUUID()} />
              <div className="field"><label htmlFor="inspectionType">ประเภทการตรวจ *</label><select id="inspectionType" name="type" required>{allowedInspectionTypes.map((type) => <option key={type} value={type}>{inspectionTypeLabel(type)}</option>)}</select></div>
              <div className="field"><label htmlFor="inspectionResult">ผลตรวจ *</label><select id="inspectionResult" name="result" required>{INSPECTION_RESULTS.map((result) => <option key={result} value={result}>{inspectionResultLabel(result)}</option>)}</select></div>
              <div className="field"><label htmlFor="inspectedAt">วันเวลาตรวจ (เวลาไทย) *</label><input id="inspectedAt" name="inspectedAt" type="datetime-local" defaultValue={datetimeLocalNowBangkok()} required /></div>
              <div className="field"><label htmlFor="odometerKm">เลขไมล์ (กม.)</label><input id="odometerKm" name="odometerKm" type="number" min={0} max={10000000} inputMode="numeric" /></div>
              <div className="field"><label htmlFor="fuelLevel">ระดับน้ำมัน</label><select id="fuelLevel" name="fuelLevel" defaultValue="UNKNOWN">{FUEL_LEVELS.map((level) => <option key={level} value={level}>{fuelLevelLabel(level)}</option>)}</select></div>
              <div className="field full"><label htmlFor="inspectionNotes">สรุปผล / เหตุผล (บังคับเมื่อพบปัญหา)</label><textarea id="inspectionNotes" name="notes" rows={3} maxLength={2000} /></div>
              <div className="inspection-finding-fields full">
                <div><b>รายการตรวจพบแรก (กรอกครบชุดเมื่อมี)</b><span>เพิ่มรายการถัดไปได้หลังบันทึกใบตรวจ</span></div>
                <div className="field"><label htmlFor="findingArea">ตำแหน่ง</label><input id="findingArea" name="findingArea" maxLength={100} placeholder="เช่น กันชนหน้า" /></div>
                <div className="field"><label htmlFor="findingSeverity">ระดับ</label><select id="findingSeverity" name="findingSeverity" defaultValue=""><option value="">ไม่ระบุรายการ</option><option value="MINOR">เล็กน้อย</option><option value="MODERATE">ปานกลาง</option><option value="MAJOR">รุนแรง</option></select></div>
                <div className="field full"><label htmlFor="findingDescription">รายละเอียด</label><textarea id="findingDescription" name="findingDescription" rows={2} minLength={3} maxLength={1000} /></div>
                <div className="field full"><label htmlFor="inspectionEvidenceImageId">รูป DAMAGE ที่เกี่ยวข้อง</label><select id="inspectionEvidenceImageId" name="evidenceImageId" defaultValue=""><option value="">ยังไม่มีรูปหลักฐาน</option>{damageImages.map((image) => <option key={image.id} value={image.id}>{formatThaiDateTime(image.createdAt)} · {image.id.slice(0, 8)}</option>)}</select></div>
              </div>
              <div className="full"><button className="button button-gradient" type="submit">บันทึกใบตรวจสภาพ</button></div>
            </form>
          )}
          {inspections.length ? <div className="inspection-list">{inspections.map((inspection) => {
            const inspectionFindingsForRecord = findings.filter((finding) => finding.inspectionId === inspection.id);
            return <article className={`app-panel inspection-card result-${inspection.result.toLowerCase()}`} key={inspection.id}>
              <div className="inspection-card-head"><div><span>{inspectionTypeLabel(inspection.type)}</span><h3>{inspectionResultLabel(inspection.result)}</h3></div><span className="status-pill">{formatThaiDateTime(inspection.inspectedAt)}</span></div>
              <dl><div><dt>ผู้ตรวจ</dt><dd>{inspection.inspectorName}</dd></div><div><dt>เลขไมล์</dt><dd>{inspection.odometerKm === null ? "ไม่ระบุ" : `${inspection.odometerKm.toLocaleString("th-TH")} กม.`}</dd></div><div><dt>น้ำมัน</dt><dd>{fuelLevelLabel(inspection.fuelLevel)}</dd></div></dl>
              <p>{inspection.notes || "ไม่พบหมายเหตุเพิ่มเติม"}</p>
              {inspectionFindingsForRecord.length > 0 && <div className="inspection-findings">{inspectionFindingsForRecord.map((finding) => <div key={finding.id}><div><b>{finding.area}</b><span className={`finding-severity ${finding.severity.toLowerCase()}`}>{damageSeverityLabel(finding.severity)}</span></div><p>{finding.description}</p>{finding.evidenceImageId ? <a href={`/api/images/${finding.evidenceImageId}`} target="_blank" rel="noreferrer">เปิดรูปหลักฐาน</a> : <span>ยังไม่มีรูปหลักฐาน</span>}</div>)}</div>}
              {canInspect && inspection.result !== "PASS" && <form className="inspection-add-finding" action={`/api/motorcycles/${id}/inspections/${inspection.id}/findings`} method="post" aria-label={`เพิ่มรายการตรวจพบในใบตรวจ ${inspectionTypeLabel(inspection.type)}`}><input type="hidden" name="requestKey" value={crypto.randomUUID()} /><input name="area" maxLength={100} required placeholder="ตำแหน่ง *" aria-label="ตำแหน่งที่ตรวจพบ" /><select name="severity" required defaultValue="MINOR" aria-label="ระดับความเสียหาย"><option value="MINOR">เล็กน้อย</option><option value="MODERATE">ปานกลาง</option><option value="MAJOR">รุนแรง</option></select><input name="description" minLength={3} maxLength={1000} required placeholder="รายละเอียด *" aria-label="รายละเอียดที่ตรวจพบ" /><select name="evidenceImageId" defaultValue="" aria-label="รูปหลักฐานความเสียหาย"><option value="">ไม่มีรูป</option>{damageImages.map((image) => <option key={image.id} value={image.id}>{formatThaiDateTime(image.createdAt)} · {image.id.slice(0, 8)}</option>)}</select><button type="submit">เพิ่มรายการตรวจพบ</button></form>}
            </article>;
          })}</div> : <div className="app-panel app-empty"><div>🧾</div><h2>ยังไม่มีใบตรวจสภาพ</h2><p>บันทึกผลตรวจจริงก่อนเปลี่ยนรถเป็นสถานะตรวจสภาพแล้ว</p></div>}
        </section>
      )}

      {canReadDocuments && (
        <section className="detail-section">
          <div className="detail-section-head"><div><p>PROOF OF DELIVERY</p><h2>หลักฐานส่งมอบ</h2></div><span>เก็บประวัติทุกฉบับ · ไม่ลบย้อนหลัง</span></div>
          {canManagePod && record.currentStatus === "ARRIVED" && !activePod && deliveryImages.length > 0 && (
            <form className="record-form pod-form" action={`/api/motorcycles/${id}/pod`} method="post">
              <input type="hidden" name="requestKey" value={crypto.randomUUID()} />
              <div className="field"><label htmlFor="recipientName">ชื่อผู้รับจริง *</label><input id="recipientName" name="recipientName" maxLength={160} autoComplete="name" required /></div>
              <div className="field"><label htmlFor="recipientPhone">เบอร์ผู้รับ</label><input id="recipientPhone" name="recipientPhone" minLength={6} maxLength={50} inputMode="tel" autoComplete="tel" /></div>
              <div className="field"><label htmlFor="deliveryLocation">สถานที่ส่งมอบ *</label><input id="deliveryLocation" name="deliveryLocation" minLength={2} maxLength={300} required /></div>
              <div className="field"><label htmlFor="deliveredAt">วันเวลาส่งมอบ (เวลาไทย) *</label><input id="deliveredAt" name="deliveredAt" type="datetime-local" defaultValue={datetimeLocalNowBangkok()} required /></div>
              <div className="field full"><label htmlFor="podEvidenceImageId">รูปส่งมอบ DELIVERY *</label><select id="podEvidenceImageId" name="evidenceImageId" required defaultValue=""><option value="">เลือกรูปหลักฐาน</option>{deliveryImages.map((image) => <option key={image.id} value={image.id}>{formatThaiDateTime(image.createdAt)} · {image.id.slice(0, 8)}</option>)}</select></div>
              <div className="field full"><label htmlFor="podNotes">หมายเหตุ</label><textarea id="podNotes" name="notes" rows={3} maxLength={2000} /></div>
              <div className="full"><button className="button button-gradient" type="submit">บันทึกหลักฐานส่งมอบ</button></div>
            </form>
          )}
          {canManagePod && record.currentStatus === "ARRIVED" && !activePod && deliveryImages.length === 0 && <div className="login-notice page-message">อัปโหลดรูปประเภท “ส่งมอบ” ก่อนสร้าง POD ระบบไม่รับรูปหมวดอื่นแทนหลักฐานส่งมอบ</div>}
          {podRecords.length ? <div className="pod-list">{podRecords.map((pod) => <article className={`app-panel pod-card ${pod.status.toLowerCase()}`} key={pod.id}>
            <div className="pod-card-head"><div><span>{pod.status === "ACTIVE" ? "ACTIVE POD" : "VOIDED POD"}</span><h3>{pod.recipientName}</h3></div><span className="status-pill">{pod.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิกแล้ว"}</span></div>
            <dl><div><dt>ส่งมอบ</dt><dd>{formatThaiDateTime(pod.deliveredAt)}</dd></div><div><dt>สถานที่</dt><dd>{pod.deliveryLocation}</dd></div><div><dt>เบอร์ผู้รับ</dt><dd>{maskPhone(pod.recipientPhone)}</dd></div><div><dt>ผู้บันทึก</dt><dd>{pod.receiverName}</dd></div></dl>
            <p>{pod.notes || "ไม่มีหมายเหตุ"}</p>
            <a className="button button-glass button-small" href={`/api/images/${pod.evidenceImageId}`} target="_blank" rel="noreferrer">เปิดรูปส่งมอบ</a>
            {pod.status === "VOIDED" && <div className="trip-release-note">เหตุผลยกเลิก: {pod.voidReason}</div>}
            {canManagePod && pod.status === "ACTIVE" && record.currentStatus === "ARRIVED" && <form className="pod-void-form" action={`/api/motorcycles/${id}/pod/${pod.id}`} method="post"><input name="reason" minLength={3} maxLength={500} required placeholder="เหตุผลยกเลิกฉบับนี้ *" aria-label="เหตุผลยกเลิกหลักฐานส่งมอบ" /><button type="submit">ยกเลิกและเก็บประวัติ</button></form>}
          </article>)}</div> : <div className="app-panel app-empty"><div>🤝</div><h2>ยังไม่มีหลักฐานส่งมอบ</h2><p>เมื่อรถถึงปลายทาง ให้บันทึกผู้รับ สถานที่ เวลา และรูปส่งมอบจริง</p></div>}
        </section>
      )}

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

function containerStatusLabel(status: string): string {
  return ({ DRAFT: "ร่าง", PLANNED: "วางแผนแล้ว", LOADING: "กำลังโหลดตู้", SEALED: "ปิด Seal แล้ว", IN_TRANSIT: "กำลังขนส่ง", ARRIVED: "ถึงปลายทาง", UNLOADING: "กำลังนำรถลง", COMPLETED: "เสร็จสิ้น", CANCELLED: "ยกเลิก" } as Record<string, string>)[status] ?? status;
}

function containerAssignmentStateLabel(state: string): string {
  return ({ ASSIGNED: "จัดเข้าตู้แล้ว", LOADED: "ยืนยันขึ้นตู้แล้ว", UNLOADED: "ยืนยันลงจากตู้แล้ว", RELEASED: "ปิดรายการแล้ว" } as Record<string, string>)[state] ?? state;
}

function inspectionTypeLabel(type: string): string {
  return ({ RECEIPT: "ตรวจรับรถ", PRE_LOAD: "ตรวจก่อนโหลด", DELIVERY: "ตรวจส่งมอบ" } as Record<string, string>)[type] ?? type;
}

function inspectionResultLabel(result: string): string {
  return ({ PASS: "ผ่าน", ISSUE: "พบข้อสังเกต", DAMAGE: "พบความเสียหาย" } as Record<string, string>)[result] ?? result;
}

function damageSeverityLabel(severity: string): string {
  return ({ MINOR: "เล็กน้อย", MODERATE: "ปานกลาง", MAJOR: "รุนแรง" } as Record<string, string>)[severity] ?? severity;
}

function fuelLevelLabel(level: string): string {
  return ({ UNKNOWN: "ไม่ทราบ", EMPTY: "หมด", QUARTER: "1/4", HALF: "1/2", THREE_QUARTERS: "3/4", FULL: "เต็ม" } as Record<string, string>)[level] ?? level;
}

function datetimeLocalNowBangkok(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
