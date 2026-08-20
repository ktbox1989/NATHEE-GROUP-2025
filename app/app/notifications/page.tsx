import { and, desc, eq, lt, or } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db";
import { notifications } from "@/db/schema";
import { requireActor } from "@/lib/current-actor";
import { isSafeNotificationHref } from "@/lib/notifications";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Props = {
  searchParams: Promise<{ before?: string; beforeId?: string; status?: string; error?: string }>;
};

export default async function NotificationsPage({ searchParams }: Props) {
  const actor = await requireActor("/app/notifications");
  const params = await searchParams;
  const cursor = params.before && params.beforeId
    ? or(
        lt(notifications.createdAt, params.before),
        and(eq(notifications.createdAt, params.before), lt(notifications.id, params.beforeId)),
      )
    : undefined;
  const rawRows = await getDb()
    .select()
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, actor.userId), cursor))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(PAGE_SIZE + 1)
    .all();
  const hasMore = rawRows.length > PAGE_SIZE;
  const rows = rawRows.slice(0, PAGE_SIZE);
  const unread = rows.filter((row) => !row.readAt).length;

  return (
    <>
      <div className="app-page-head">
        <div><p>NOTIFICATIONS</p><h1>การแจ้งเตือน</h1><span>เหตุการณ์จริงที่เกี่ยวข้องกับบัญชีนี้ · ยังไม่อ่านในหน้านี้ {unread}</span></div>
      </div>
      {params.status === "read" && <div className="form-message success page-message">บันทึกว่าอ่านแล้วและเปิดรายการที่เกี่ยวข้อง</div>}
      {params.error && <div className="form-message error page-message" role="alert">เปิดการแจ้งเตือนไม่สำเร็จ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง</div>}

      {rows.length ? <div className="notification-list">{rows.map((row) => {
        const safeHref = isSafeNotificationHref(row.href) ? row.href : null;
        return <article className={`notification-card ${row.readAt ? "read" : "unread"} ${row.severity.toLowerCase()}`} key={row.id}>
          <span className="notification-signal" aria-hidden="true" />
          <div className="notification-copy">
            <div><span>{row.severity}</span><time dateTime={row.createdAt}>{row.createdAt}</time></div>
            <h2>{row.title}</h2>
            <p>{row.body}</p>
          </div>
          <div className="notification-actions">
            {!row.readAt && safeHref && <form action={`/api/notifications/${row.id}/read`} method="post"><button className="button button-gradient button-small" type="submit">เปิดรายการ</button></form>}
            {row.readAt && safeHref && <Link className="button button-glass button-small" href={safeHref}>ดูอีกครั้ง</Link>}
            {!safeHref && <span className="status-pill">ลิงก์ไม่พร้อมใช้งาน</span>}
          </div>
        </article>;
      })}</div> : <section className="app-panel app-empty"><div aria-hidden="true">🔔</div><h2>ยังไม่มีการแจ้งเตือน</h2><p>เมื่อมีสถานะรถของบริษัทคุณเปลี่ยน ระบบจะแสดงรายการจริงที่นี่</p></section>}

      {hasMore && rows.length > 0 && <nav className="batch-navigation" aria-label="หน้าการแจ้งเตือน"><span>แสดงครั้งละ {PAGE_SIZE} รายการ</span><Link className="button button-glass button-small" href={`/app/notifications?before=${encodeURIComponent(rows.at(-1)!.createdAt)}&beforeId=${encodeURIComponent(rows.at(-1)!.id)}`}>หน้าถัดไป</Link></nav>}
    </>
  );
}
