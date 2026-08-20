import Link from "next/link";
import { asc, desc, eq, notInArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { companies, motorcycles, transportJobs } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { motorcycleStatusLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

type MotorcyclesPageProps = {
  searchParams: Promise<{ status?: string; error?: string }>;
};

export default async function MotorcyclesPage({ searchParams }: MotorcyclesPageProps) {
  const actor = await requireActor("/app/motorcycles");
  const policyCompany = actor.role === "CUSTOMER" ? actor.companyId : undefined;
  if (!can(actor, "motorcycles:read", policyCompany)) redirect("/app");
  const params = await searchParams;
  const db = getDb();
  const scope = actor.role === "CUSTOMER" && actor.companyId
    ? eq(motorcycles.companyId, actor.companyId)
    : undefined;
  const rows = await db
    .select({
      id: motorcycles.id,
      publicId: motorcycles.publicId,
      sequenceNumber: motorcycles.sequenceNumber,
      jobNumber: transportJobs.jobNumber,
      companyName: companies.displayName,
      make: motorcycles.make,
      model: motorcycles.model,
      color: motorcycles.color,
      registration: motorcycles.registration,
      vin: motorcycles.vin,
      engineNumber: motorcycles.engineNumber,
      status: motorcycles.currentStatus,
    })
    .from(motorcycles)
    .innerJoin(transportJobs, eq(transportJobs.id, motorcycles.jobId))
    .innerJoin(companies, eq(companies.id, motorcycles.companyId))
    .where(scope)
    .orderBy(desc(motorcycles.createdAt))
    .limit(200)
    .all();
  const canWrite = can(actor, "motorcycles:write", policyCompany);
  const jobRows = canWrite
    ? await db
        .select({
          id: transportJobs.id,
          jobNumber: transportJobs.jobNumber,
          companyName: companies.displayName,
        })
        .from(transportJobs)
        .innerJoin(companies, eq(companies.id, transportJobs.companyId))
        .where(notInArray(transportJobs.status, ["COMPLETED", "CANCELLED"]))
        .orderBy(asc(transportJobs.jobNumber))
        .all()
    : [];

  return (
    <>
      <div className="app-page-head">
        <div><p>MOTORCYCLE RECORDS</p><h1>รถจักรยานยนต์</h1><span>{actor.role === "CUSTOMER" ? "รถของบริษัทคุณเท่านั้น" : "ทะเบียนรถ รูปภาพ สถานะ และ Timeline"}</span></div>
      </div>
      {params.status === "created" && <div className="form-message success page-message">เพิ่มรถเข้าระบบเรียบร้อยแล้ว</div>}
      {params.error && <div className="form-message error page-message">เพิ่มรถไม่สำเร็จ กรุณาตรวจสอบ Job, VIN และเลขเครื่อง</div>}
      {canWrite && (
        <form className="record-form" action="/api/motorcycles" method="post">
          <div className="field full"><label htmlFor="jobId">งานขนส่ง *</label><select id="jobId" name="jobId" required><option value="">เลือก Job</option>{jobRows.map((job) => <option key={job.id} value={job.id}>{job.jobNumber} · {job.companyName}</option>)}</select></div>
          <div className="field"><label htmlFor="make">ยี่ห้อ</label><input id="make" name="make" placeholder="เช่น Honda" /></div>
          <div className="field"><label htmlFor="model">รุ่น</label><input id="model" name="model" /></div>
          <div className="field"><label htmlFor="color">สี</label><input id="color" name="color" /></div>
          <div className="field"><label htmlFor="registration">ทะเบียน</label><input id="registration" name="registration" /></div>
          <div className="field"><label htmlFor="vin">เลขโครง / VIN</label><input id="vin" name="vin" /></div>
          <div className="field"><label htmlFor="engineNumber">เลขเครื่อง</label><input id="engineNumber" name="engineNumber" /></div>
          <div className="full"><button className="button button-gradient" type="submit">เพิ่มรถเข้าระบบ</button></div>
        </form>
      )}
      <div className="data-card">
        {rows.length ? (
          <div className="data-table-wrap"><table className="data-table">
            <thead><tr><th>รถ / JOB</th><th>บริษัท</th><th>รายละเอียด</th><th>VIN / เลขเครื่อง</th><th>สถานะ</th></tr></thead>
            <tbody>{rows.map((motorcycle) => (
              <tr key={motorcycle.id}>
                <td><Link href={`/app/motorcycles/${motorcycle.id}`}><b>คันที่ {motorcycle.sequenceNumber}</b></Link><small>{motorcycle.jobNumber}</small></td>
                <td>{motorcycle.companyName}</td>
                <td>{[motorcycle.make, motorcycle.model, motorcycle.color].filter(Boolean).join(" · ") || "ยังไม่ระบุ"}<small>{motorcycle.registration || "ไม่มีทะเบียน"}</small></td>
                <td>{maskSensitive(motorcycle.vin)}<small>{maskSensitive(motorcycle.engineNumber)}</small></td>
                <td><span className="status-pill">{motorcycleStatusLabels[motorcycle.status]}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="app-empty"><div>🏍️</div><h2>ยังไม่มีรถจักรยานยนต์</h2><p>เพิ่มรถจาก Job เพื่อเริ่มบันทึกรูปและสถานะ</p></div>}
      </div>
    </>
  );
}

function maskSensitive(value: string | null): string {
  if (!value) return "—";
  if (value.length <= 6) return value;
  return `••••••${value.slice(-6)}`;
}
