import { asc, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { companies, transportJobs } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";

export const dynamic = "force-dynamic";

type JobsPageProps = {
  searchParams: Promise<{ status?: string; error?: string }>;
};

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const actor = await requireActor("/app/jobs");
  const policyCompany = actor.role === "CUSTOMER" ? actor.companyId : undefined;
  if (!can(actor, "jobs:read", policyCompany)) redirect("/app");
  const params = await searchParams;
  const db = getDb();
  const scope = actor.role === "CUSTOMER" && actor.companyId
    ? eq(transportJobs.companyId, actor.companyId)
    : undefined;
  const rows = await db
    .select({
      id: transportJobs.id,
      jobNumber: transportJobs.jobNumber,
      companyName: companies.displayName,
      origin: transportJobs.origin,
      destination: transportJobs.destination,
      pickup: transportJobs.plannedPickupDate,
      delivery: transportJobs.plannedDeliveryDate,
      status: transportJobs.status,
      createdAt: transportJobs.createdAt,
    })
    .from(transportJobs)
    .innerJoin(companies, eq(companies.id, transportJobs.companyId))
    .where(scope)
    .orderBy(desc(transportJobs.createdAt))
    .all();
  const canWrite = can(actor, "jobs:write", policyCompany);
  const companyRows = canWrite
    ? await db
        .select({ id: companies.id, code: companies.code, name: companies.displayName })
        .from(companies)
        .where(eq(companies.status, "ACTIVE"))
        .orderBy(asc(companies.code))
        .all()
    : [];

  return (
    <>
      <div className="app-page-head">
        <div><p>TRANSPORT JOBS</p><h1>งานขนส่ง</h1><span>{actor.role === "CUSTOMER" ? "งานของบริษัทคุณเท่านั้น" : "เปิดงานและติดตามความคืบหน้า"}</span></div>
      </div>
      {params.status === "created" && <div className="form-message success page-message">เปิดงานขนส่งเรียบร้อยแล้ว</div>}
      {params.error && <div className="form-message error page-message">เปิดงานไม่สำเร็จ กรุณาตรวจสอบข้อมูล</div>}
      {canWrite && (
        <form className="record-form" action="/api/jobs" method="post">
          <div className="field full"><label htmlFor="companyId">บริษัทลูกค้า *</label><select id="companyId" name="companyId" required><option value="">เลือกบริษัท</option>{companyRows.map((company) => <option key={company.id} value={company.id}>{company.code} · {company.name}</option>)}</select></div>
          <div className="field"><label htmlFor="origin">จุดรับรถ *</label><input id="origin" name="origin" required /></div>
          <div className="field"><label htmlFor="destination">จุดส่งรถ *</label><input id="destination" name="destination" required /></div>
          <div className="field"><label htmlFor="plannedPickupDate">วันที่รับรถ</label><input id="plannedPickupDate" name="plannedPickupDate" type="date" /></div>
          <div className="field"><label htmlFor="plannedDeliveryDate">วันที่ส่งโดยประมาณ</label><input id="plannedDeliveryDate" name="plannedDeliveryDate" type="date" /></div>
          <div className="field full"><label htmlFor="notes">หมายเหตุ</label><textarea id="notes" name="notes" rows={3} /></div>
          <div className="full"><button className="button button-gradient" type="submit">เปิดงานขนส่ง</button></div>
        </form>
      )}
      <div className="data-card">
        {rows.length ? (
          <div className="data-table-wrap"><table className="data-table">
            <thead><tr><th>JOB NO.</th><th>บริษัท</th><th>เส้นทาง</th><th>กำหนดการ</th><th>สถานะ</th></tr></thead>
            <tbody>{rows.map((job) => (
              <tr key={job.id}>
                <td><b>{job.jobNumber}</b><small>{job.createdAt}</small></td>
                <td>{job.companyName}</td>
                <td>{job.origin} → {job.destination}</td>
                <td>{job.pickup || "—"}<small>{job.delivery ? `ส่งโดยประมาณ ${job.delivery}` : "ยังไม่ระบุวันส่ง"}</small></td>
                <td><span className="status-pill">{job.status}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="app-empty"><div>📦</div><h2>ยังไม่มีงานขนส่ง</h2><p>เมื่อเปิดงาน รายการจะปรากฏที่นี่ตามสิทธิ์ของผู้ใช้</p></div>}
      </div>
    </>
  );
}
