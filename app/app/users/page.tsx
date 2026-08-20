import { asc, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { companies, users } from "@/db/schema";
import { PERMISSIONS } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { roleLabels } from "@/lib/labels";
import { isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type UsersPageProps = {
  searchParams: Promise<{ status?: string; error?: string }>;
};

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const actor = await requireActor("/app/users");
  if (actor.role !== "OWNER") redirect("/app");
  const params = await searchParams;
  const db = getDb();
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      role: users.role,
      status: users.status,
      companyName: companies.displayName,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(companies, eq(companies.id, users.companyId))
    .orderBy(desc(users.createdAt))
    .all();
  const companyRows = await db
    .select({ id: companies.id, code: companies.code, name: companies.displayName })
    .from(companies)
    .where(eq(companies.status, "ACTIVE"))
    .orderBy(asc(companies.code))
    .all();
  const adminConfigured = isSupabaseAdminConfigured();

  return (
    <>
      <div className="app-page-head">
        <div><p>USERS & ROLES</p><h1>สมาชิกและสิทธิ์</h1><span>เชิญผู้ใช้และผูกลูกค้ากับบริษัทก่อนเข้าใช้งาน</span></div>
      </div>
      {params.status === "invited" && <div className="form-message success page-message">ส่งคำเชิญและบันทึกสิทธิ์เรียบร้อยแล้ว</div>}
      {params.error && <div className="form-message error page-message">สร้างบัญชีไม่สำเร็จ กรุณาตรวจสอบอีเมล บริษัท และการตั้งค่าระบบยืนยันตัวตน</div>}
      {!adminConfigured && <div className="login-notice page-message">ต้องตั้งค่า Secret Key ฝั่งเซิร์ฟเวอร์ก่อนเปิดฟังก์ชันเชิญสมาชิก</div>}
      {adminConfigured && (
        <form className="record-form" action="/api/users/invite" method="post">
          <div className="field"><label htmlFor="displayName">ชื่อที่แสดง *</label><input id="displayName" name="displayName" required /></div>
          <div className="field"><label htmlFor="email">อีเมล *</label><input id="email" name="email" type="email" required /></div>
          <div className="field"><label htmlFor="role">Role *</label><select id="role" name="role" required><option value="STAFF">พนักงาน</option><option value="CUSTOMER">ลูกค้าบริษัท</option><option value="OWNER">เจ้าของระบบ</option></select></div>
          <div className="field"><label htmlFor="companyId">บริษัท (จำเป็นสำหรับ CUSTOMER)</label><select id="companyId" name="companyId"><option value="">ไม่ผูกบริษัท</option>{companyRows.map((company) => <option key={company.id} value={company.id}>{company.code} · {company.name}</option>)}</select></div>
          <fieldset className="permission-fieldset full"><legend>สิทธิ์สำหรับ STAFF</legend><div className="permission-grid">{PERMISSIONS.map((permission) => <label key={permission}><input type="checkbox" name="permissions" value={permission} /> {permission}</label>)}</div></fieldset>
          <div className="full"><button className="button button-gradient" type="submit">ส่งคำเชิญเข้าใช้งาน</button></div>
        </form>
      )}
      <div className="data-card">
        {rows.length ? <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>ผู้ใช้</th><th>Role</th><th>บริษัท</th><th>สถานะ</th></tr></thead>
          <tbody>{rows.map((user) => <tr key={user.id}>
            <td><b>{user.displayName}</b><small>{user.email}</small></td>
            <td>{roleLabels[user.role]}</td>
            <td>{user.companyName || "—"}</td>
            <td><span className="status-pill">{user.status}</span></td>
          </tr>)}</tbody>
        </table></div> : <div className="app-empty"><div>👥</div><h2>ยังไม่มีสมาชิก</h2><p>บัญชีเจ้าของเริ่มต้นต้องตั้งค่าในขั้นเปิดระบบครั้งแรก</p></div>}
      </div>
    </>
  );
}
