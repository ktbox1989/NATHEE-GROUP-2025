import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { QrScanner } from "@/components/qr-scanner";
import { getDb } from "@/db";
import { companies, motorcycleInspections, motorcycles, transportJobs, trips, trucks, users, yardZones } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { can, isCustomerRole, isInternalRole } from "@/lib/authorization";
import { requireActor, type CurrentActor } from "@/lib/current-actor";
import { motorcycleStatusLabels } from "@/lib/labels";
import { receiptInspectionHasFourAngles } from "@/lib/intake-inspection";
import { parseOperationalQrToken, type ParsedOperationalQrToken } from "@/lib/qr";
import { getMotorcycleLocation } from "@/lib/yard-location";

export const dynamic = "force-dynamic";

type ScanPageProps = { searchParams: Promise<{ code?: string }> };
type ScanResult = {
  entityType: string;
  title: string;
  subtitle: string;
  status: string;
  details: ReadonlyArray<{ label: string; value: string }>;
  href: string;
  actionLabel: string;
};

export default async function ScanPage({ searchParams }: ScanPageProps) {
  const actor = await requireActor("/app/scan");
  if (!can(actor, "motorcycles:read", isCustomerRole(actor.role) ? actor.companyId : undefined) && !can(actor, "jobs:read")) redirect("/app");
  const { code } = await searchParams;
  const parsed = code === undefined ? null : parseOperationalQrToken(code);
  const result = parsed ? await resolveScanResult(parsed, actor) : null;

  return <>
    <div className="app-page-head"><div><p>SECURE QR LOOKUP</p><h1>สแกน QR งานปฏิบัติการ</h1><span>รองรับรถจักรยานยนต์ งานขนส่ง โซนลาน รถขนส่ง และเที่ยววิ่ง โดย QR เก็บเฉพาะรหัส opaque</span></div></div>
    <div className="qr-scan-grid">
      <QrScanner />
      <section className="app-panel qr-manual-card" aria-labelledby="manual-title">
        <p>MANUAL LOOKUP</p><h2 id="manual-title">กรอกรหัสใต้ QR</h2><p>ใช้กรณีกล้องไม่พร้อมหรือ QR เสียหาย ระบบตรวจสิทธิ์ก่อนแสดงข้อมูลทุกชนิด</p>
        <form action="/app/scan" method="get"><div className="field"><label htmlFor="code">QR token หรือ Public ID</label><input id="code" name="code" maxLength={128} autoComplete="off" spellCheck={false} required defaultValue={code ?? ""} placeholder="NATHEE:MC:mc_…" /></div><button className="button button-gradient" type="submit">ตรวจสอบข้อมูล</button></form>
      </section>
    </div>
    {code !== undefined && !parsed && <div className="form-message error page-message" role="alert">รหัส QR ไม่ถูกต้อง กรุณาสแกนใหม่หรือตรวจรหัสใต้ฉลาก</div>}
    {parsed && !result && <div className="form-message error page-message" role="alert">ไม่พบข้อมูลที่คุณมีสิทธิ์เข้าถึง กรุณาตรวจ QR หรือติดต่อผู้ดูแล</div>}
    {result && <section className="app-panel scan-result" aria-labelledby="scan-result-title"><div className="scan-result-head"><div><p>{result.entityType}</p><h2 id="scan-result-title">{result.title}</h2><span>{result.subtitle}</span></div><span className="status-pill">{result.status}</span></div><dl>{result.details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value || "—"}</dd></div>)}</dl><Link className="button button-gradient" href={result.href}>{result.actionLabel}</Link></section>}
  </>;
}

async function resolveScanResult(parsed: ParsedOperationalQrToken, actor: CurrentActor): Promise<ScanResult | null> {
  const db = getDb();
  if (parsed.entityType === "motorcycle") {
    const record = await db.select({ id: motorcycles.id, companyId: motorcycles.companyId, companyName: companies.displayName, jobNumber: transportJobs.jobNumber, sequenceNumber: motorcycles.sequenceNumber, make: motorcycles.make, model: motorcycles.model, color: motorcycles.color, registration: motorcycles.registration, currentStatus: motorcycles.currentStatus })
      .from(motorcycles).innerJoin(companies, eq(companies.id, motorcycles.companyId)).innerJoin(transportJobs, eq(transportJobs.id, motorcycles.jobId)).where(eq(motorcycles.publicId, parsed.publicId)).get();
    if (!record || !can(actor, "motorcycles:read", record.companyId)) return null;
    const [latestReceipt, yardLocation] = await Promise.all([
      db.select({ result: motorcycleInspections.result, leftImageId: motorcycleInspections.leftImageId, rightImageId: motorcycleInspections.rightImageId, frontImageId: motorcycleInspections.frontImageId, rearImageId: motorcycleInspections.rearImageId })
        .from(motorcycleInspections)
        .where(and(eq(motorcycleInspections.motorcycleId, record.id), eq(motorcycleInspections.type, "RECEIPT")))
        .orderBy(desc(motorcycleInspections.inspectedAt), desc(motorcycleInspections.id))
        .get(),
      can(actor, "yard:read") ? getMotorcycleLocation(record.id) : Promise.resolve(null),
    ]);
    await writeAudit({ actor, action: "QR_RESOLVE", entityType: "motorcycle", entityId: record.id, companyId: record.companyId, after: { publicId: parsed.publicId, status: record.currentStatus } });
    const inspectionState = latestReceipt
      ? `${latestReceipt.result}${receiptInspectionHasFourAngles(latestReceipt) ? " · รูปครบ 4 มุม" : " · รูปยังไม่ครบ"}`
      : "ยังไม่มีใบตรวจรับ";
    return { entityType: "VEHICLE", title: `${record.jobNumber} · คันที่ ${record.sequenceNumber}`, subtitle: record.companyName, status: motorcycleStatusLabels[record.currentStatus], details: [{ label: "ยี่ห้อ / รุ่น", value: [record.make, record.model].filter(Boolean).join(" · ") }, { label: "สี", value: record.color ?? "—" }, { label: "ทะเบียน", value: record.registration ?? "—" }, { label: "ตรวจรับ", value: inspectionState }, { label: "ตำแหน่งลาน", value: yardLocation?.label ?? "อยู่นอกลาน" }], href: `/app/motorcycles/${record.id}`, actionLabel: "เปิดรายละเอียดรถและทำขั้นถัดไป" };
  }
  if (parsed.entityType === "job") {
    const record = await db.select({ id: transportJobs.id, companyId: transportJobs.companyId, jobNumber: transportJobs.jobNumber, companyName: companies.displayName, origin: transportJobs.origin, destination: transportJobs.destination, status: transportJobs.status, pickup: transportJobs.plannedPickupDate, delivery: transportJobs.plannedDeliveryDate })
      .from(transportJobs).innerJoin(companies, eq(companies.id, transportJobs.companyId)).where(eq(transportJobs.publicId, parsed.publicId)).get();
    if (!record || !can(actor, "jobs:read", record.companyId)) return null;
    return { entityType: "TRANSPORT JOB", title: record.jobNumber, subtitle: record.companyName, status: record.status, details: [{ label: "ต้นทาง", value: record.origin }, { label: "ปลายทาง", value: record.destination }, { label: "วันรับ", value: record.pickup ?? "ยังไม่กำหนด" }, { label: "วันส่ง", value: record.delivery ?? "ยังไม่กำหนด" }], href: "/app/jobs", actionLabel: "เปิดรายการงานขนส่ง" };
  }
  if (!isInternalRole(actor.role)) return null;
  if (parsed.entityType === "yard") {
    if (!can(actor, "yard:read")) return null;
    const record = await db.select().from(yardZones).where(eq(yardZones.publicId, parsed.publicId)).get();
    if (!record) return null;
    return { entityType: "YARD ZONE", title: `โซน ${record.code}`, subtitle: record.name, status: record.status, details: [{ label: "ความจุ", value: record.capacity ? `${record.capacity} คัน` : "ไม่จำกัด" }, { label: "รายละเอียด", value: record.description ?? "—" }], href: "/app/yard", actionLabel: "เปิดจัดการลาน" };
  }
  if (!can(actor, "jobs:read")) return null;
  if (parsed.entityType === "truck") {
    const record = await db.select().from(trucks).where(eq(trucks.publicId, parsed.publicId)).get();
    if (!record) return null;
    const type = record.type === "FOUR_WHEEL" ? "รถขนส่ง 4 ล้อ" : record.type === "SIX_WHEEL" ? "รถขนส่ง 6 ล้อ" : "ประเภทอื่น";
    return { entityType: "TRUCK", title: record.code, subtitle: type, status: record.status, details: [{ label: "ทะเบียน", value: record.registration ?? "ยังไม่ระบุ" }, { label: "ความจุ", value: record.capacityMotorcycles ? `${record.capacityMotorcycles} คัน` : "ยังไม่ยืนยัน" }], href: "/app/trips", actionLabel: "เปิดรถและเที่ยววิ่ง" };
  }
  const record = await db.select({ id: trips.id, tripNumber: trips.tripNumber, origin: trips.origin, destination: trips.destination, status: trips.status, truckCode: trucks.code, driverName: users.displayName }).from(trips).innerJoin(trucks, eq(trucks.id, trips.truckId)).leftJoin(users, eq(users.id, trips.driverUserId)).where(eq(trips.publicId, parsed.publicId)).get();
  if (!record) return null;
  return { entityType: "TRIP", title: record.tripNumber, subtitle: `${record.origin} → ${record.destination}`, status: record.status, details: [{ label: "รถ", value: record.truckCode }, { label: "คนขับ", value: record.driverName ?? "ยังไม่กำหนด" }], href: `/app/trips/${record.id}`, actionLabel: "เปิด Load Board และ Timeline" };
}
