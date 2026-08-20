/* eslint-disable @next/next/no-img-element -- Private evidence is served through the authenticated same-origin R2 endpoint. */
import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { getDb } from "@/db";
import {
  companies,
  inspectionFindings,
  motorcycleInspections,
  motorcycles,
  proofOfDeliveryRecords,
  proofOfDeliverySignatures,
  transportJobs,
  users,
} from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { maskPhone } from "@/lib/inspections";
import { motorcycleStatusLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function MotorcycleDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor(`/app/motorcycles/${id}/documents`);
  const db = getDb();
  const record = await db
    .select({
      id: motorcycles.id,
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
    .where(eq(motorcycles.id, id))
    .get();
  if (!record || !can(actor, "documents:read", record.companyId)) notFound();

  const [inspections, findings, pods] = await Promise.all([
    db
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
      .orderBy(asc(motorcycleInspections.inspectedAt), asc(motorcycleInspections.id))
      .limit(50)
      .all(),
    db
      .select({
        id: inspectionFindings.id,
        inspectionId: inspectionFindings.inspectionId,
        area: inspectionFindings.area,
        severity: inspectionFindings.severity,
        description: inspectionFindings.description,
        evidenceImageId: inspectionFindings.evidenceImageId,
      })
      .from(inspectionFindings)
      .innerJoin(motorcycleInspections, eq(motorcycleInspections.id, inspectionFindings.inspectionId))
      .where(eq(motorcycleInspections.motorcycleId, id))
      .orderBy(asc(inspectionFindings.createdAt), asc(inspectionFindings.id))
      .limit(100)
      .all(),
    db
      .select({
        id: proofOfDeliveryRecords.id,
        recipientName: proofOfDeliveryRecords.recipientName,
        recipientPhone: proofOfDeliveryRecords.recipientPhone,
        deliveryLocation: proofOfDeliveryRecords.deliveryLocation,
        deliveredAt: proofOfDeliveryRecords.deliveredAt,
        evidenceImageId: proofOfDeliveryRecords.evidenceImageId,
        notes: proofOfDeliveryRecords.notes,
        status: proofOfDeliveryRecords.status,
        signatureId: proofOfDeliverySignatures.id,
        signatureRequired: proofOfDeliveryRecords.signatureRequired,
        voidReason: proofOfDeliveryRecords.voidReason,
        receiverName: users.displayName,
      })
      .from(proofOfDeliveryRecords)
      .innerJoin(users, eq(users.id, proofOfDeliveryRecords.receivedBy))
      .leftJoin(proofOfDeliverySignatures, eq(proofOfDeliverySignatures.podId, proofOfDeliveryRecords.id))
      .where(eq(proofOfDeliveryRecords.motorcycleId, id))
      .orderBy(asc(proofOfDeliveryRecords.createdAt), asc(proofOfDeliveryRecords.id))
      .limit(20)
      .all(),
  ]);

  return (
    <>
      <div className="app-page-head print-hidden">
        <div><p>DOCUMENT & PRINT CENTER</p><h1>เอกสารรถคันที่ {record.sequenceNumber}</h1><span>ข้อมูลจริงจากใบตรวจและหลักฐานส่งมอบที่เก็บในระบบ</span></div>
        <div className="app-page-actions"><Link href={`/app/motorcycles/${id}`}>← กลับรายละเอียด</Link><PrintButton label="พิมพ์ / บันทึก PDF" /></div>
      </div>
      <main className="document-print-sheet">
        <header className="document-brand"><div><b>NATHEE GROUP 2025</b><span>MOTORCYCLE OPERATIONS RECORD</span></div><small>สร้างจากข้อมูลในระบบ · {formatThaiDateTime(new Date().toISOString())}</small></header>
        <section className="document-summary">
          <div><span>Job</span><b>{record.jobNumber} · คันที่ {record.sequenceNumber}</b></div>
          <div><span>ลูกค้า</span><b>{record.companyName}</b></div>
          <div><span>รถ</span><b>{[record.make, record.model, record.color].filter(Boolean).join(" · ") || "ไม่ระบุ"}</b></div>
          <div><span>ทะเบียน</span><b>{record.registration || "ไม่ระบุ"}</b></div>
          <div><span>VIN</span><b>{record.vin || "ไม่ระบุ"}</b></div>
          <div><span>เลขเครื่อง</span><b>{record.engineNumber || "ไม่ระบุ"}</b></div>
          <div><span>สถานะ</span><b>{motorcycleStatusLabels[record.currentStatus]}</b></div>
        </section>

        <section className="document-section">
          <h2>ใบตรวจสภาพ <span>{inspections.length} รายการ</span></h2>
          {inspections.length ? inspections.map((inspection, index) => {
            const recordFindings = findings.filter((finding) => finding.inspectionId === inspection.id);
            return <article className="document-record" key={inspection.id}>
              <header><div><span>INSPECTION {index + 1}</span><h3>{inspectionTypeLabel(inspection.type)} · {inspectionResultLabel(inspection.result)}</h3></div><b>{formatThaiDateTime(inspection.inspectedAt)}</b></header>
              <dl><div><dt>ผู้ตรวจ</dt><dd>{inspection.inspectorName}</dd></div><div><dt>เลขไมล์</dt><dd>{inspection.odometerKm === null ? "ไม่ระบุ" : `${inspection.odometerKm.toLocaleString("th-TH")} กม.`}</dd></div><div><dt>น้ำมัน</dt><dd>{fuelLevelLabel(inspection.fuelLevel)}</dd></div></dl>
              <p>{inspection.notes || "ไม่มีหมายเหตุ"}</p>
              {recordFindings.map((finding) => <div className="document-finding" key={finding.id}><div><b>{finding.area}</b><span>{damageSeverityLabel(finding.severity)}</span></div><p>{finding.description}</p>{finding.evidenceImageId && <img src={`/api/images/${finding.evidenceImageId}?role=display`} alt={`หลักฐาน ${finding.area}`} width={640} height={480} loading="lazy" decoding="async" />}</div>)}
            </article>;
          }) : <p className="document-empty">ยังไม่มีใบตรวจสภาพ</p>}
        </section>

        <section className="document-section">
          <h2>หลักฐานส่งมอบ <span>{pods.length} ฉบับ</span></h2>
          {pods.length ? pods.map((pod, index) => <article className={`document-record pod-${pod.status.toLowerCase()}`} key={pod.id}>
            <header><div><span>POD {index + 1}</span><h3>{pod.status === "ACTIVE" ? "หลักฐานที่ใช้งาน" : "ฉบับยกเลิก"}</h3></div><b>{formatThaiDateTime(pod.deliveredAt)}</b></header>
            <dl><div><dt>ผู้รับ</dt><dd>{pod.recipientName}</dd></div><div><dt>โทร</dt><dd>{maskPhone(pod.recipientPhone)}</dd></div><div><dt>สถานที่</dt><dd>{pod.deliveryLocation}</dd></div><div><dt>ผู้บันทึก</dt><dd>{pod.receiverName}</dd></div></dl>
            <p>{pod.notes || "ไม่มีหมายเหตุ"}</p>
            {pod.status === "VOIDED" && <p className="document-void-reason">ยกเลิก: {pod.voidReason}</p>}
            <img className="document-pod-image" src={`/api/images/${pod.evidenceImageId}?role=display`} alt={`รูปส่งมอบให้ ${pod.recipientName}`} width={640} height={480} loading="lazy" decoding="async" />
            {pod.signatureId ? <div className="document-signature"><span>ลายเซ็นผู้รับ</span><img src={`/api/pod-signatures/${pod.signatureId}`} alt={`ลายเซ็นผู้รับ ${pod.recipientName}`} width={720} height={240} loading="lazy" decoding="async" /></div> : <p className="document-signature-missing">{pod.signatureRequired === 0 ? "POD เดิมก่อนระบบลายเซ็น — ไม่มีไฟล์ลายเซ็นในระบบ" : "POD ใหม่มีหลักฐานลายเซ็นไม่ครบและยังยืนยันส่งมอบไม่ได้"}</p>}
          </article>) : <p className="document-empty">ยังไม่มีหลักฐานส่งมอบ</p>}
        </section>
        <footer className="document-footer">เอกสารนี้แสดงข้อมูล ณ เวลาที่พิมพ์ ประวัติต้นฉบับและ Audit อยู่ใน NATHEE SYSTEM</footer>
      </main>
    </>
  );
}

function formatThaiDateTime(value: string): string {
  const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(date);
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
