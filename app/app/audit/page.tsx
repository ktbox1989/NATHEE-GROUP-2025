import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { auditLogs, companies, users } from "@/db/schema";
import { requireActor } from "@/lib/current-actor";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const actor = await requireActor("/app/audit");
  if (actor.role !== "OWNER") redirect("/app");
  const rows = await getDb()
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      reason: auditLogs.reason,
      createdAt: auditLogs.createdAt,
      actorName: users.displayName,
      companyName: companies.displayName,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .leftJoin(companies, eq(companies.id, auditLogs.companyId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(200)
    .all();

  return (
    <>
      <div className="app-page-head"><div><p>AUDIT LOG</p><h1>ประวัติการเปลี่ยนแปลง</h1><span>กิจกรรมสำคัญล่าสุด 200 รายการ</span></div></div>
      <div className="data-card">{rows.length ? <div className="data-table-wrap"><table className="data-table">
        <thead><tr><th>เวลา</th><th>ผู้ดำเนินการ</th><th>การกระทำ</th><th>รายการ</th><th>บริษัท / เหตุผล</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <td>{row.createdAt}</td><td>{row.actorName || "SYSTEM"}</td><td><span className="status-pill">{row.action}</span></td>
          <td>{row.entityType}<small>{row.entityId}</small></td><td>{row.companyName || "—"}<small>{row.reason || "ไม่มีหมายเหตุ"}</small></td>
        </tr>)}</tbody>
      </table></div> : <div className="app-empty"><div>🔍</div><h2>ยังไม่มี Audit Log</h2><p>กิจกรรมสำคัญจะถูกบันทึกอัตโนมัติ</p></div>}</div>
    </>
  );
}
