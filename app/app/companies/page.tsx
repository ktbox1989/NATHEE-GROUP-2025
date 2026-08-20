import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { companies } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";

export const dynamic = "force-dynamic";

type CompaniesPageProps = {
  searchParams: Promise<{ status?: string; error?: string }>;
};

export default async function CompaniesPage({ searchParams }: CompaniesPageProps) {
  const actor = await requireActor("/app/companies");
  if (!can(actor, "companies:read")) redirect("/app");
  const params = await searchParams;
  const rows = await getDb().select().from(companies).orderBy(asc(companies.code)).all();
  const canWrite = can(actor, "companies:write");

  return (
    <>
      <div className="app-page-head">
        <div><p>CUSTOMER COMPANIES</p><h1>บริษัทลูกค้า</h1><span>ข้อมูลบริษัทที่ใช้แบ่งสิทธิ์และงานขนส่ง</span></div>
      </div>
      {params.status === "created" && <div className="form-message success page-message">เพิ่มบริษัทลูกค้าเรียบร้อยแล้ว</div>}
      {params.error && <div className="form-message error page-message">บันทึกไม่สำเร็จ กรุณาตรวจสอบรหัสบริษัทและข้อมูลที่จำเป็น</div>}
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
        {rows.length ? (
          <div className="data-table-wrap"><table className="data-table">
            <thead><tr><th>รหัส</th><th>บริษัท</th><th>ผู้ติดต่อ</th><th>สถานะ</th></tr></thead>
            <tbody>{rows.map((company) => (
              <tr key={company.id}>
                <td><b>{company.code}</b></td>
                <td><b>{company.displayName}</b><small>{company.legalName}</small></td>
                <td>{company.contactName || "—"}<small>{company.contactPhone || company.contactEmail || "ยังไม่ระบุ"}</small></td>
                <td><span className="status-pill">{company.status}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="app-empty"><div>🏢</div><h2>ยังไม่มีบริษัทลูกค้า</h2><p>เพิ่มบริษัทแรกเพื่อเริ่มสร้างงานขนส่ง</p></div>}
      </div>
    </>
  );
}
