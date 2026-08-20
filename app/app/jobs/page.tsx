import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";
/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- the scoped overflow table must be keyboard-focusable */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { companies, transportJobs } from "@/db/schema";
import { can, isCustomerRole } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { DIRECTORY_PAGE_SIZE, normalizeDirectorySearch, parseCreatedCursor } from "@/lib/directory-search";

export const dynamic = "force-dynamic";

type JobsPageProps = {
  searchParams: Promise<{ status?: string; error?: string; before?: string; beforeId?: string; companyQ?: string }>;
};

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const actor = await requireActor("/app/jobs");
  const customerRole = isCustomerRole(actor.role);
  const policyCompany = customerRole ? actor.companyId : undefined;
  if (!can(actor, "jobs:read", policyCompany)) redirect("/app");
  const params = await searchParams;
  const cursor = parseCreatedCursor(params.before, params.beforeId);
  if (cursor === null) notFound();
  const companySearch = normalizeDirectorySearch(params.companyQ ?? "");
  if (companySearch === undefined) notFound();
  const db = getDb();
  const scope = customerRole && actor.companyId
    ? eq(transportJobs.companyId, actor.companyId)
    : undefined;
  const cursorFilter = cursor
    ? or(lt(transportJobs.createdAt, cursor.createdAt), and(eq(transportJobs.createdAt, cursor.createdAt), lt(transportJobs.id, cursor.id)))
    : undefined;
  const jobRowsPromise = db
    .select({
      id: transportJobs.id,
      companyId: transportJobs.companyId,
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
    .where(and(scope, cursorFilter))
    .orderBy(desc(transportJobs.createdAt), desc(transportJobs.id))
    .limit(DIRECTORY_PAGE_SIZE + 1)
    .all();
  const canWrite = can(actor, "jobs:write", policyCompany);
  const companyRowsPromise = canWrite
    ? companySearch
      ? Promise.all([
          db.select({ id: companies.id, code: companies.code, name: companies.displayName }).from(companies)
            .where(and(eq(companies.status, "ACTIVE"), sql`${companies.code} GLOB ${`${companySearch.toUpperCase()}*`}`))
            .orderBy(asc(companies.code)).limit(DIRECTORY_PAGE_SIZE + 1).all(),
          db.select({ id: companies.id, code: companies.code, name: companies.displayName }).from(companies)
            .where(and(eq(companies.status, "ACTIVE"), sql`${companies.displayName} GLOB ${`${companySearch}*`}`))
            .orderBy(asc(companies.displayName), asc(companies.code)).limit(DIRECTORY_PAGE_SIZE + 1).all(),
        ]).then(([codeRows, nameRows]) => mergeCompanyRows(codeRows, nameRows))
      : db.select({ id: companies.id, code: companies.code, name: companies.displayName }).from(companies)
          .where(eq(companies.status, "ACTIVE")).orderBy(asc(companies.code)).limit(DIRECTORY_PAGE_SIZE + 1).all()
    : [];
  const [jobRows, companyRows] = await Promise.all([jobRowsPromise, companyRowsPromise]);
  const hasMore = jobRows.length > DIRECTORY_PAGE_SIZE;
  const rows = jobRows.slice(0, DIRECTORY_PAGE_SIZE);
  const next = rows.at(-1);
  const companiesTruncated = companyRows.length > DIRECTORY_PAGE_SIZE;
  const visibleCompanies = companyRows.slice(0, DIRECTORY_PAGE_SIZE);

  return (
    <>
      <div className="app-page-head">
        <div><p>TRANSPORT JOBS</p><h1>งานขนส่ง</h1><span>{customerRole ? "งานของบริษัทคุณเท่านั้น" : "เปิดงานและติดตามความคืบหน้า"}</span></div>
      </div>
      {params.status === "created" && <div className="form-message success page-message">เปิดงานขนส่งเรียบร้อยแล้ว</div>}
      {params.error && <div className="form-message error page-message">เปิดงานไม่สำเร็จ กรุณาตรวจสอบข้อมูล</div>}
      {canWrite && (
        <>
        <form className="trip-load-search directory-search" action="/app/jobs" method="get" role="search">
          <label htmlFor="companyQ">ค้นหาบริษัทด้วยรหัสหรือชื่อ (ขึ้นต้นด้วย)</label>
          <div><input id="companyQ" name="companyQ" minLength={2} maxLength={80} defaultValue={companySearch ?? ""} placeholder="เช่น CUS-000123 หรือ บริษัท นที" /><button type="submit">ค้นหาบริษัท</button>{companySearch && <Link href="/app/jobs">ล้าง</Link>}</div>
        </form>
        <form className="record-form" action="/api/jobs" method="post">
          <div className="field full"><label htmlFor="companyId">บริษัทลูกค้า *</label><select id="companyId" name="companyId" required><option value="">เลือกบริษัท</option>{visibleCompanies.map((company) => <option key={company.id} value={company.id}>{company.code} · {company.name}</option>)}</select></div>
          <div className="field"><label htmlFor="origin">จุดรับรถ *</label><input id="origin" name="origin" required /></div>
          <div className="field"><label htmlFor="destination">จุดส่งรถ *</label><input id="destination" name="destination" required /></div>
          <div className="field"><label htmlFor="plannedPickupDate">วันที่รับรถ</label><input id="plannedPickupDate" name="plannedPickupDate" type="date" /></div>
          <div className="field"><label htmlFor="plannedDeliveryDate">วันที่ส่งโดยประมาณ</label><input id="plannedDeliveryDate" name="plannedDeliveryDate" type="date" /></div>
          <div className="field full"><label htmlFor="notes">หมายเหตุ</label><textarea id="notes" name="notes" rows={3} /></div>
          <div className="full"><button className="button button-gradient" type="submit">เปิดงานขนส่ง</button></div>
        </form>
        {companiesTruncated && <div className="login-notice page-message">พบมากกว่า {DIRECTORY_PAGE_SIZE} บริษัท กรุณาระบุรหัสหรือชื่อให้เจาะจงขึ้น</div>}
        </>
      )}
      <div className="data-card">
        {rows.length ? (
          <div className="data-table-wrap" tabIndex={0} role="region" aria-label="ตารางงานขนส่ง เลื่อนแนวนอนได้บนหน้าจอเล็ก"><table className="data-table">
            <thead><tr><th>JOB NO.</th><th>บริษัท</th><th>เส้นทาง</th><th>กำหนดการ</th><th>สถานะ</th><th>ฉลาก</th></tr></thead>
            <tbody>{rows.map((job) => (
              <tr key={job.id}>
                <td><b>{job.jobNumber}</b><small>{job.createdAt}</small></td>
                <td>{job.companyName}</td>
                <td>{job.origin} → {job.destination}</td>
                <td>{job.pickup || "—"}<small>{job.delivery ? `ส่งโดยประมาณ ${job.delivery}` : "ยังไม่ระบุวันส่ง"}</small></td>
                <td><span className="status-pill">{job.status}</span></td>
                <td>{can(actor, "motorcycles:write", job.companyId) ? <Link href={`/app/jobs/${job.id}/labels`}>พิมพ์ QR</Link> : "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="app-empty"><div>📦</div><h2>ยังไม่มีงานขนส่ง</h2><p>เมื่อเปิดงาน รายการจะปรากฏที่นี่ตามสิทธิ์ของผู้ใช้</p></div>}
      </div>
      <nav className="batch-navigation" aria-label="หน้างานขนส่ง"><span>แสดงสูงสุด {DIRECTORY_PAGE_SIZE} งานต่อหน้า</span>{hasMore && next && <Link className="button button-glass button-small" href={`/app/jobs?before=${encodeURIComponent(next.createdAt)}&beforeId=${encodeURIComponent(next.id)}${companySearch ? `&companyQ=${encodeURIComponent(companySearch)}` : ""}`}>หน้าถัดไป</Link>}</nav>
    </>
  );
}

type CompanyOption = { id: string; code: string; name: string };

function mergeCompanyRows(...groups: CompanyOption[][]): CompanyOption[] {
  const unique = new Map(groups.flat().map((company) => [company.id, company]));
  return [...unique.values()].sort((left, right) => left.code.localeCompare(right.code)).slice(0, DIRECTORY_PAGE_SIZE + 1);
}
