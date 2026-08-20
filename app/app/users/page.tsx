import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { companies, userPermissions, userRoleAssignments, users, USER_ROLES } from "@/db/schema";
import { effectiveRoleFromLegacy, PERMISSIONS } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { roleLabels } from "@/lib/labels";
import { isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type UsersPageProps = {
  searchParams: Promise<{ status?: string; error?: string; before?: string; beforeId?: string }>;
};

const USER_PAGE_SIZE = 50;
const COMPANY_SELECTOR_LIMIT = 500;

const errorMessages: Record<string, string> = {
  invalid: "ข้อมูลไม่ครบหรือเหตุผลสั้นเกินไป",
  company: "บทบาทลูกค้าต้องผูกกับบริษัทที่ยังใช้งานอยู่",
  invite: "ระบบ Auth ไม่รับคำเชิญ กรุณาตรวจการตั้งค่าฝั่งเซิร์ฟเวอร์",
  save: "บันทึกไม่สำเร็จ ระบบยกเลิกธุรกรรมแล้ว",
  stale: "ข้อมูลถูกแก้จากอีกหน้าจอ กรุณาโหลดหน้าใหม่ก่อนบันทึก",
  self_lockout: "Owner ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตนเองได้",
  last_owner: "ต้องมี Owner ที่ใช้งานอยู่อย่างน้อยหนึ่งบัญชี",
  not_found: "ไม่พบบัญชีหรือบัญชีถูก Archive แล้ว",
};

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const actor = await requireActor("/app/users");
  if (actor.role !== "OWNER") redirect("/app");
  const params = await searchParams;
  const db = getDb();
  const cursorCondition = params.before && params.beforeId
    ? or(
        lt(users.createdAt, params.before),
        and(eq(users.createdAt, params.before), lt(users.id, params.beforeId)),
      )
    : undefined;
  const rawRows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      assignedRole: userRoleAssignments.role,
      legacyRole: users.role,
      status: users.status,
      companyId: users.companyId,
      companyName: companies.displayName,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
    .leftJoin(companies, eq(companies.id, users.companyId))
    .where(cursorCondition)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(USER_PAGE_SIZE + 1)
    .all();
  const hasMore = rawRows.length > USER_PAGE_SIZE;
  const pageRows = rawRows.slice(0, USER_PAGE_SIZE);
  const rows = pageRows.map((user) => ({
    ...user,
    role: user.assignedRole ?? effectiveRoleFromLegacy(user.legacyRole),
  }));
  const permissionRows = rows.length
    ? await db
        .select({ userId: userPermissions.userId, permission: userPermissions.permission })
        .from(userPermissions)
        .where(inArray(userPermissions.userId, rows.map((row) => row.id)))
        .all()
    : [];
  const permissionsByUser = new Map<string, Set<string>>();
  for (const permission of permissionRows) {
    const values = permissionsByUser.get(permission.userId) ?? new Set<string>();
    values.add(permission.permission);
    permissionsByUser.set(permission.userId, values);
  }
  const companyRows = await db
    .select({ id: companies.id, code: companies.code, name: companies.displayName })
    .from(companies)
    .where(eq(companies.status, "ACTIVE"))
    .orderBy(asc(companies.code))
    .limit(COMPANY_SELECTOR_LIMIT)
    .all();
  const adminConfigured = isSupabaseAdminConfigured();

  return (
    <>
      <div className="app-page-head">
        <div><p>USERS & ROLES</p><h1>สมาชิกและสิทธิ์</h1><span>เชิญผู้ใช้และผูกลูกค้ากับบริษัทก่อนเข้าใช้งาน</span></div>
      </div>
      {params.status === "invited" && <div className="form-message success page-message">ส่งคำเชิญและบันทึกสิทธิ์เรียบร้อยแล้ว</div>}
      {params.status === "updated" && <div className="form-message success page-message">อัปเดตบทบาท สิทธิ์ และสถานะพร้อม Audit Log แล้ว</div>}
      {params.status === "no_change" && <div className="login-notice page-message">ไม่มีค่าที่เปลี่ยน ระบบจึงไม่ได้สร้าง Audit ซ้ำ</div>}
      {params.error && <div className="form-message error page-message" role="alert">{errorMessages[params.error] ?? "ดำเนินการไม่สำเร็จและไม่มีการยืนยันผล กรุณาลองใหม่"}</div>}
      {!adminConfigured && <div className="login-notice page-message">ต้องตั้งค่า Secret Key ฝั่งเซิร์ฟเวอร์ก่อนเปิดฟังก์ชันเชิญสมาชิก</div>}
      {adminConfigured && (
        <form className="record-form" action="/api/users/invite" method="post">
          <div className="field"><label htmlFor="displayName">ชื่อที่แสดง *</label><input id="displayName" name="displayName" required /></div>
          <div className="field"><label htmlFor="email">อีเมล *</label><input id="email" name="email" type="email" required /></div>
          <div className="field"><label htmlFor="role">Role *</label><select id="role" name="role" required>{USER_ROLES.map((role) => <option value={role} key={role}>{roleLabels[role]}</option>)}</select></div>
          <div className="field"><label htmlFor="companyId">บริษัท (จำเป็นสำหรับ Customer roles)</label><select id="companyId" name="companyId"><option value="">ไม่ผูกบริษัท</option>{companyRows.map((company) => <option key={company.id} value={company.id}>{company.code} · {company.name}</option>)}</select></div>
          <fieldset className="permission-fieldset full"><legend>สิทธิ์สำหรับบทบาทภายใน (ยกเว้น OWNER)</legend><div className="permission-grid">{PERMISSIONS.map((permission) => <label key={permission}><input type="checkbox" name="permissions" value={permission} /> {permission}</label>)}</div></fieldset>
          <div className="full"><button className="button button-gradient" type="submit">ส่งคำเชิญเข้าใช้งาน</button></div>
        </form>
      )}
      {companyRows.length === COMPANY_SELECTOR_LIMIT && <div className="login-notice page-message">รายการบริษัทถูกจำกัดที่ {COMPANY_SELECTOR_LIMIT} รายการเพื่อป้องกันหน้าเว็บทำงานหนัก ควรเพิ่ม Company Search contract ก่อนมีลูกค้าเกินขนาดนี้</div>}
      {rows.length ? <div className="member-list">{rows.map((user) => {
        const selectedPermissions = permissionsByUser.get(user.id) ?? new Set<string>();
        const isCurrentActor = user.id === actor.userId;
        return <details className="member-card" id={user.id} key={user.id}>
          <summary>
            <span className="member-identity"><b>{user.displayName}</b><small>{user.email}</small></span>
            <span>{roleLabels[user.role]}</span>
            <span>{user.companyName || "ไม่ผูกบริษัท"}</span>
            <span className={`status-pill ${user.status}`}>{user.status === "ACTIVE" ? "ใช้งาน" : "ปิดใช้งาน"}</span>
          </summary>
          <form className="member-management-form" action={`/api/users/${user.id}`} method="post">
            {isCurrentActor && <div className="login-notice full">บัญชีที่กำลังใช้งาน: แก้รายละเอียดได้ แต่ระบบจะปฏิเสธการลด Role หรือปิดบัญชีตนเอง</div>}
            <div className="field"><label htmlFor={`role-${user.id}`}>Role</label><select id={`role-${user.id}`} name="role" defaultValue={user.role}>{USER_ROLES.map((role) => <option value={role} key={role}>{roleLabels[role]}</option>)}</select></div>
            <div className="field"><label htmlFor={`company-${user.id}`}>บริษัทลูกค้า</label><select id={`company-${user.id}`} name="companyId" defaultValue={user.companyId ?? ""}>
              <option value="">ไม่ผูกบริษัท</option>{companyRows.map((company) => <option key={company.id} value={company.id}>{company.code} · {company.name}</option>)}
            </select></div>
            <div className="field"><label htmlFor={`status-${user.id}`}>สถานะบัญชี</label><select id={`status-${user.id}`} name="status" defaultValue={user.status}><option value="ACTIVE">ใช้งาน</option><option value="INACTIVE">ปิดใช้งาน (ไม่ลบประวัติ)</option></select></div>
            <div className="field"><label htmlFor={`reason-${user.id}`}>เหตุผลการเปลี่ยนแปลง *</label><input id={`reason-${user.id}`} name="reason" minLength={3} maxLength={500} required placeholder="บันทึกใน Audit Log" /></div>
            <fieldset className="permission-fieldset full"><legend>สิทธิ์ explicit สำหรับบทบาทภายใน (OWNER/Customer จะไม่ใช้รายการนี้)</legend><div className="permission-grid">{PERMISSIONS.map((permission) => <label key={permission}><input type="checkbox" name="permissions" value={permission} defaultChecked={selectedPermissions.has(permission)} /> {permission}</label>)}</div></fieldset>
            <div className="member-form-footer full"><p>การปิดบัญชีมีผลกับแอปทันทีเมื่อมีคำขอใหม่ แต่ไม่ลบ Auth identity หรือประวัติธุรกิจ</p><button className="button button-gradient button-small" type="submit">บันทึกสิทธิ์และสถานะ</button></div>
          </form>
        </details>;
      })}</div> : <div className="data-card"><div className="app-empty"><div>👥</div><h2>ยังไม่มีสมาชิก</h2><p>บัญชีเจ้าของเริ่มต้นต้องตั้งค่าในขั้นเปิดระบบครั้งแรก</p></div></div>}
      {hasMore && rows.length > 0 && <nav className="batch-navigation" aria-label="หน้ารายชื่อสมาชิก"><span>แสดงครั้งละ {USER_PAGE_SIZE} บัญชี</span><a className="button button-glass button-small" href={`/app/users?before=${encodeURIComponent(rows.at(-1)!.createdAt)}&beforeId=${encodeURIComponent(rows.at(-1)!.id)}`}>หน้าถัดไป</a></nav>}
      <div className="login-notice page-message member-recovery-note">ผู้ใช้ที่ลืมรหัสผ่านให้ใช้หน้า <a href="/forgot-password">ขอลิงก์ตั้งรหัสผ่านใหม่</a> ระบบจะไม่แสดงหรือเก็บรหัสผ่านเดิม</div>
    </>
  );
}
