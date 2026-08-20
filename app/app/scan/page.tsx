import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { QrScanner } from "@/components/qr-scanner";
import { getDb } from "@/db";
import { companies, motorcycles, transportJobs } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { motorcycleStatusLabels } from "@/lib/labels";
import { parseMotorcycleQrToken } from "@/lib/qr";

export const dynamic = "force-dynamic";

type ScanPageProps = {
  searchParams: Promise<{ code?: string }>;
};

export default async function ScanPage({ searchParams }: ScanPageProps) {
  const actor = await requireActor("/app/scan");
  const policyCompany = actor.role === "CUSTOMER" ? actor.companyId : undefined;
  if (!can(actor, "motorcycles:read", policyCompany)) redirect("/app");

  const { code } = await searchParams;
  const publicId = code === undefined ? null : parseMotorcycleQrToken(code);
  const customerScope = actor.role === "CUSTOMER" && actor.companyId
    ? eq(motorcycles.companyId, actor.companyId)
    : undefined;
  const record = publicId
    ? await getDb()
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
          currentStatus: motorcycles.currentStatus,
        })
        .from(motorcycles)
        .innerJoin(companies, eq(companies.id, motorcycles.companyId))
        .innerJoin(transportJobs, eq(transportJobs.id, motorcycles.jobId))
        .where(and(eq(motorcycles.publicId, publicId), customerScope))
        .get()
    : null;
  const visibleRecord = record && can(actor, "motorcycles:read", record.companyId) ? record : null;

  return (
    <>
      <div className="app-page-head">
        <div><p>SECURE QR LOOKUP</p><h1>สแกน QR รถจักรยานยนต์</h1><span>QR เก็บเฉพาะรหัสอ้างอิง ระบบตรวจสิทธิ์ก่อนแสดงข้อมูลทุกครั้ง</span></div>
      </div>

      <div className="qr-scan-grid">
        <QrScanner />
        <section className="app-panel qr-manual-card" aria-labelledby="manual-title">
          <p>MANUAL LOOKUP</p>
          <h2 id="manual-title">กรอกรหัสใต้ QR</h2>
          <p>ใช้กรณีกล้องไม่พร้อมหรือ QR เสียหาย</p>
          <form action="/app/scan" method="get">
            <div className="field">
              <label htmlFor="code">QR token หรือ Public ID</label>
              <input id="code" name="code" maxLength={128} autoComplete="off" spellCheck={false} required defaultValue={code ?? ""} placeholder="NATHEE:MC:mc_…" />
            </div>
            <button className="button button-gradient" type="submit">ตรวจสอบข้อมูล</button>
          </form>
        </section>
      </div>

      {code !== undefined && !publicId && (
        <div className="form-message error page-message" role="alert">รหัส QR ไม่ถูกต้อง กรุณาสแกนใหม่หรือตรวจรหัสใต้ฉลาก</div>
      )}
      {publicId && !visibleRecord && (
        <div className="form-message error page-message" role="alert">ไม่พบข้อมูลที่คุณมีสิทธิ์เข้าถึง กรุณาตรวจ QR หรือติดต่อผู้ดูแล</div>
      )}
      {visibleRecord && (
        <section className="app-panel scan-result" aria-labelledby="scan-result-title">
          <div className="scan-result-head">
            <div><p>SCAN RESULT</p><h2 id="scan-result-title">{visibleRecord.jobNumber} · คันที่ {visibleRecord.sequenceNumber}</h2></div>
            <span className="status-pill">{motorcycleStatusLabels[visibleRecord.currentStatus]}</span>
          </div>
          <dl>
            <div><dt>บริษัท</dt><dd>{visibleRecord.companyName}</dd></div>
            <div><dt>ยี่ห้อ / รุ่น</dt><dd>{[visibleRecord.make, visibleRecord.model].filter(Boolean).join(" · ") || "—"}</dd></div>
            <div><dt>สี</dt><dd>{visibleRecord.color || "—"}</dd></div>
            <div><dt>ทะเบียน</dt><dd>{visibleRecord.registration || "—"}</dd></div>
          </dl>
          <Link className="button button-gradient" href={`/app/motorcycles/${visibleRecord.id}`}>เปิดรายละเอียดรถ</Link>
        </section>
      )}
    </>
  );
}
