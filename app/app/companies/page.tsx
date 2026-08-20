import { asc, gt, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { companies } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { DIRECTORY_PAGE_SIZE, normalizeDirectorySearch } from "@/lib/directory-search";

export const dynamic = "force-dynamic";

type CompaniesPageProps = {
  searchParams: Promise<{ status?: string; error?: string; q?: string; afterCode?: string }>;
};

export default async function CompaniesPage({ searchParams }: CompaniesPageProps) {
  const actor = await requireActor("/app/companies");
  if (!can(actor, "companies:read")) redirect("/app");
  const params = await searchParams;
  const search = normalizeDirectorySearch(params.q ?? "");
  if (search === undefined || (params.afterCode && (params.afterCode.length > 80 || search))) notFound();
  const db = getDb();
  const rows = search
    ? mergeCompanyRows(
        await db.select().from(companies).where(sql`${companies.code} GLOB ${`${search.toUpperCase()}*`}`).orderBy(asc(companies.code)).limit(DIRECTORY_PAGE_SIZE + 1).all(),
        await db.select().from(companies).where(sql`${companies.displayName} GLOB ${`${search}*`}`).orderBy(asc(companies.displayName), asc(companies.code)).limit(DIRECTORY_PAGE_SIZE + 1).all(),
      )
    : await db.select().from(companies).where(params.afterCode ? gt(companies.code, params.afterCode) : undefined).orderBy(asc(companies.code)).limit(DIRECTORY_PAGE_SIZE + 1).all();
  const hasMore = rows.length > DIRECTORY_PAGE_SIZE;
  const visibleRows = rows.slice(0, DIRECTORY_PAGE_SIZE);
  const next = visibleRows.at(-1);
  const canWrite = can(actor, "companies:write");

  return (
    <>
      <div className="app-page-head">
        <div><p>CUSTOMER COMPANIES</p><h1>บริษัทลูกค้า</h1><span>ข้อมูลบริษัทที่ใช้แบ่งสิทธิ์และงานขนส่ง</span></div>
      </div>
      {params.status === "created" && <div className="form-message success page-message">เพิ่มบริษัทลูกค้าเรียบร้อยแล้ว</div>}
      {params.error && <div className="form-message error page-message">บันทึกไม่สำเร็จ กรุณาตรวจสอบรหัสบริษัทและข้อมูลที่จำเป็น</div>}
      <form className="trip-load-search directory-search" action="/app/companies" method="get" role="search">
        <label htmlFor="company-directory-q">ค้นหาด้วยรหัสหรือชื่อบริษัท (ขึ้นต้นด้วย)</label>
        <div><input id="company-directory-q" name="q" minLength={2} maxLength={80} defaultValue={search ?? ""} placeholder="เช่น CUS-000123 หรือ บริษัท นที" /><button type="submit">ค้นหา</button>{search && <Link href="/app/companies">ล้าง</Link>}</div>
      </form>
      {canWrite && (
        <form className="record-form" action="/api/companies" method="post">
          <div className="field"><label htmlFor="code">รหัสบริษัท *</label><input id="code" name="code" placeholder="เช่น CUS-000123" required /></div>
          <div className="field"><label htmlFor="displayName">ชื่อที่แสดง *</label><input id="displayName" name="displayName" required /></div>
          <div className="field full"><label htmlFor="legalName">ชื่อบริษัทตามเอกสาร *</label><input id="legalName" name="legalName" required /></div>
          <div className="field"><label htmlFor="contactName">ผู้ติดต่อ</label><input id="contactName" name="contactName" /></div>
          <div className="field"><label htmlFor="contactPhone">เบอร์โทร</label><input id="contactPhone" name="contactPhone" inputMode="tel" /></div>
          <div className="field"><label htmlFor="contactEmail">อีเมล</label><input id="contactEmail" name="contactEmail" type="email" inputMode="email" /></div>
          <div className="field"><label htmlFor="taxId">เลขประจำตัวผู้เสียภาษี</label><input id="taxId" name="taxId" inputMode="numeric" /></div>
          <div className="full"><button className="button button-gradient" type="submit">เพิ่มบริษัทลูกค้า</button></div>
        </form>
      )}
      <div className="data-card">
        {visibleRows.length ? (
          <div className="data-table-wrap"><table className="data-table">
            <thead><tr><th>รหัส</th><th>บริษัท</th><th>ผู้ติดต่อ</th><th>สถานะ</th></tr></thead>
            <tbody>{visibleRows.map((company) => (
              <tr key={company.id}>
                <td><b>{company.code}</b></td>
                <td><b>{company.displayName}</b><small>{company.legalName}</small></td>
                <td>{company.contactName || "—"}<small>{company.contactPhone || company.contactEmail || "ยังไม่ระบุ"}</small></td>
                <td><span className="status-pill">{company.status}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="app-empty"><div>🏢</div><h2>{search ? "ไม่พบบริษัทตรงกับคำค้น" : "ยังไม่มีบริษัทลูกค้า"}</h2><p>{search ? "ตรวจรหัสหรือชื่อบริษัทแล้วค้นหาอีกครั้ง" : "เพิ่มบริษัทแรกเพื่อเริ่มสร้างงานขนส่ง"}</p></div>}
      </div>
      <nav className="batch-navigation" aria-label="หน้าบริษัทลูกค้า"><span>แสดงสูงสุด {DIRECTORY_PAGE_SIZE} บริษัทต่อหน้า</span>{hasMore && next && !search && <Link className="button button-glass button-small" href={`/app/companies?afterCode=${encodeURIComponent(next.code)}`}>หน้าถัดไป</Link>}</nav>
      {hasMore && search && <div className="login-notice page-message">พบมากกว่า {DIRECTORY_PAGE_SIZE} บริษัท กรุณาระบุคำค้นให้เจาะจงขึ้น</div>}
    </>
  );
}

type CompanyRow = typeof companies.$inferSelect;

function mergeCompanyRows(...groups: CompanyRow[][]): CompanyRow[] {
  const unique = new Map(groups.flat().map((company) => [company.id, company]));
  return [...unique.values()].sort((left, right) => left.code.localeCompare(right.code)).slice(0, DIRECTORY_PAGE_SIZE + 1);
}
