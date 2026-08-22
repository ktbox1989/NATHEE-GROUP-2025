/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- the scoped overflow table must be keyboard-focusable */
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { auditLogs, companies, users } from "@/db/schema";
import {
  AUDIT_VIEWS,
  auditRowDetail,
  auditViewActions,
  auditViewKeys,
  DEFAULT_AUDIT_VIEW,
  parseAuditView,
} from "@/lib/audit-view";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { parseCreatedCursor } from "@/lib/directory-search";

export const dynamic = "force-dynamic";

const AUDIT_PAGE_SIZE = 50;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; beforeId?: string; view?: string }>;
}) {
  const actor = await requireActor("/app/audit");
  if (!can(actor, "audit:read")) redirect("/app");
  const query = await searchParams;
  const cursor = parseCreatedCursor(query.before, query.beforeId);
  if (cursor === null) notFound();
  const requestedView = parseAuditView(query.view);
  if (requestedView === null) notFound();
  const view = requestedView ?? DEFAULT_AUDIT_VIEW;

  const actions = auditViewActions(view);
  const cursorFilter = cursor
    ? or(
        lt(auditLogs.createdAt, cursor.createdAt),
        and(eq(auditLogs.createdAt, cursor.createdAt), lt(auditLogs.id, cursor.id)),
      )
    : undefined;
  const filters = [
    actions ? inArray(auditLogs.action, [...actions]) : undefined,
    cursorFilter,
  ].filter(Boolean);

  const rowsWithExtra = await getDb()
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      afterJson: auditLogs.afterJson,
      reason: auditLogs.reason,
      createdAt: auditLogs.createdAt,
      actorName: users.displayName,
      companyName: companies.displayName,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .leftJoin(companies, eq(companies.id, auditLogs.companyId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(AUDIT_PAGE_SIZE + 1)
    .all();
  const hasMore = rowsWithExtra.length > AUDIT_PAGE_SIZE;
  const rows = rowsWithExtra.slice(0, AUDIT_PAGE_SIZE);
  const next = rows.at(-1);
  const viewSuffix = view === DEFAULT_AUDIT_VIEW ? "" : `&view=${view}`;

  return (
    <>
      <div className="app-page-head"><div><p>AUDIT LOG</p><h1>ประวัติการเปลี่ยนแปลง</h1><span>เรียงตามเวลาและแบ่งหน้าครั้งละ {AUDIT_PAGE_SIZE} รายการ</span></div></div>
      <nav className="filter-chips" aria-label="ตัวกรองประวัติ">
        {auditViewKeys().map((key) => (
          <Link
            key={key}
            className={`button button-small ${key === view ? "button-gradient" : "button-glass"}`}
            href={key === DEFAULT_AUDIT_VIEW ? "/app/audit" : `/app/audit?view=${key}`}
            aria-current={key === view ? "page" : undefined}
          >
            {AUDIT_VIEWS[key].label}
          </Link>
        ))}
      </nav>
      <div className="data-card">{rows.length ? <div className="data-table-wrap" tabIndex={0} role="region" aria-label="ตารางประวัติการเปลี่ยนแปลง เลื่อนแนวนอนได้บนหน้าจอเล็ก"><table className="data-table">
        <thead><tr><th>เวลา</th><th>ผู้ดำเนินการ</th><th>การกระทำ</th><th>รายการ</th><th>บริษัท / เหตุผล</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <td>{row.createdAt}</td><td>{row.actorName || "SYSTEM"}</td><td><span className="status-pill">{row.action}</span></td>
          <td>{row.entityType}<small>{row.entityId}</small></td>
          <td>{row.companyName || "—"}<small>{auditRowDetail(row.entityType, row.afterJson, row.reason) || "ไม่มีหมายเหตุ"}</small></td>
        </tr>)}</tbody>
      </table></div> : <div className="app-empty"><div>🔍</div><h2>ยังไม่มี Audit Log</h2><p>กิจกรรมสำคัญจะถูกบันทึกอัตโนมัติ</p></div>}</div>
      <nav className="batch-navigation" aria-label="หน้าประวัติการเปลี่ยนแปลง"><span>แสดง {rows.length} รายการในหน้านี้</span>{hasMore && next && <Link className="button button-glass button-small" href={`/app/audit?before=${encodeURIComponent(next.createdAt)}&beforeId=${encodeURIComponent(next.id)}${viewSuffix}`}>หน้าถัดไป</Link>}</nav>
    </>
  );
}
