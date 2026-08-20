/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- the scoped overflow table must be keyboard-focusable */
import Link from "next/link";
import { and, count, desc, eq, isNull, lt, or } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { companies, motorcycles, transportJobs, yardPlacements, yardZones } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { motorcycleStatusLabels } from "@/lib/labels";
import { parseYardCursor, YARD_PAGE_SIZE } from "@/lib/yard";

export const dynamic = "force-dynamic";

type YardPageProps = {
  searchParams: Promise<{ status?: string; error?: string; before?: string; beforeId?: string }>;
};

export default async function YardPage({ searchParams }: YardPageProps) {
  const actor = await requireActor("/app/yard");
  if (!can(actor, "yard:read")) redirect("/app");
  const params = await searchParams;
  const cursor = parseYardCursor(params.before, params.beforeId);
  if (cursor === null) notFound();
  const db = getDb();
  const cursorFilter = cursor
    ? or(
        lt(yardPlacements.enteredAt, cursor.enteredAt),
        and(eq(yardPlacements.enteredAt, cursor.enteredAt), lt(yardPlacements.id, cursor.id)),
      )
    : undefined;
  const [zoneRows, placementRows] = await Promise.all([
    db
      .select({
        id: yardZones.id,
        code: yardZones.code,
        name: yardZones.name,
        description: yardZones.description,
        capacity: yardZones.capacity,
        status: yardZones.status,
        occupied: count(yardPlacements.id),
      })
      .from(yardZones)
      .leftJoin(yardPlacements, and(eq(yardPlacements.yardZoneId, yardZones.id), isNull(yardPlacements.exitedAt)))
      .groupBy(yardZones.id)
      .orderBy(yardZones.code)
      .all(),
    db
      .select({
        placementId: yardPlacements.id,
        enteredAt: yardPlacements.enteredAt,
        motorcycleId: motorcycles.id,
        sequenceNumber: motorcycles.sequenceNumber,
        registration: motorcycles.registration,
        make: motorcycles.make,
        model: motorcycles.model,
        currentStatus: motorcycles.currentStatus,
        jobNumber: transportJobs.jobNumber,
        companyName: companies.displayName,
        zoneCode: yardZones.code,
        zoneName: yardZones.name,
      })
      .from(yardPlacements)
      .innerJoin(yardZones, eq(yardZones.id, yardPlacements.yardZoneId))
      .innerJoin(motorcycles, eq(motorcycles.id, yardPlacements.motorcycleId))
      .innerJoin(transportJobs, eq(transportJobs.id, motorcycles.jobId))
      .innerJoin(companies, eq(companies.id, motorcycles.companyId))
      .where(and(isNull(yardPlacements.exitedAt), cursorFilter))
      .orderBy(desc(yardPlacements.enteredAt), desc(yardPlacements.id))
      .limit(YARD_PAGE_SIZE + 1)
      .all(),
  ]);
  const hasMore = placementRows.length > YARD_PAGE_SIZE;
  const placements = placementRows.slice(0, YARD_PAGE_SIZE);
  const next = placements.at(-1);
  const canWrite = can(actor, "yard:write");

  return (
    <>
      <div className="app-page-head">
        <div><p>YARD OPERATIONS</p><h1>จัดการลานจอด</h1><span>ตำแหน่งรถปัจจุบัน ความจุโซน และประวัติการย้ายที่ตรวจสอบย้อนหลังได้</span></div>
      </div>
      {params.status === "zone_created" && <div className="form-message success page-message">สร้างโซนลานเรียบร้อยแล้ว</div>}
      {params.status === "zone_updated" && <div className="form-message success page-message">อัปเดตสถานะโซนเรียบร้อยแล้ว</div>}
      {params.error && <div className="form-message error page-message">บันทึกโซนไม่สำเร็จ โซนที่ยังมีรถอยู่ไม่สามารถปิดใช้งานได้</div>}

      {canWrite && (
        <form className="record-form" action="/api/yard/zones" method="post">
          <div className="field"><label htmlFor="code">รหัสโซน *</label><input id="code" name="code" maxLength={30} placeholder="เช่น A-01" required /></div>
          <div className="field"><label htmlFor="name">ชื่อโซน *</label><input id="name" name="name" maxLength={120} placeholder="ลานรับเข้า" required /></div>
          <div className="field"><label htmlFor="capacity">ความจุ (คัน)</label><input id="capacity" name="capacity" type="number" min={1} max={100000} inputMode="numeric" /></div>
          <div className="field"><label htmlFor="description">รายละเอียด</label><input id="description" name="description" maxLength={500} /></div>
          <div className="full"><button className="button button-gradient" type="submit">สร้างโซนลาน</button></div>
        </form>
      )}

      <div className="yard-zone-grid">
        {zoneRows.map((zone) => {
          const full = zone.capacity !== null && zone.occupied >= zone.capacity;
          return <article className={`app-panel yard-zone-card ${full ? "full" : ""}`} key={zone.id}>
            <div><span>{zone.code}</span><span className="status-pill">{zone.status === "ACTIVE" ? "ใช้งาน" : "ปิดใช้งาน"}</span></div>
            <h2>{zone.name}</h2>
            <p>{zone.description || "ไม่มีรายละเอียด"}</p>
            <strong>{zone.occupied}<small> / {zone.capacity ?? "ไม่จำกัด"} คัน</small></strong>
            {full && <em>พื้นที่เต็ม</em>}
            {canWrite && <form className="yard-zone-status-form" action={`/api/yard/zones/${zone.id}/status`} method="post"><input type="hidden" name="status" value={zone.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"} /><button type="submit">{zone.status === "ACTIVE" ? "ปิดใช้งาน" : "เปิดใช้งาน"}</button></form>}
          </article>;
        })}
        {!zoneRows.length && <div className="app-panel app-empty yard-empty"><div>🅿️</div><h2>ยังไม่มีโซนลาน</h2><p>สร้างโซนจริงก่อนบันทึกตำแหน่งรถ</p></div>}
      </div>

      <section className="detail-section">
        <div className="detail-section-head"><div><p>ACTIVE PLACEMENTS</p><h2>รถที่อยู่ในลานขณะนี้</h2></div><span>{placements.length} รายการในหน้านี้</span></div>
        {placements.length ? <div className="data-card"><div className="data-table-wrap" tabIndex={0} role="region" aria-label="ตารางรถในลาน เลื่อนแนวนอนได้บนหน้าจอเล็ก"><table className="data-table">
          <thead><tr><th>โซน</th><th>รถ / JOB</th><th>บริษัท</th><th>รายละเอียด</th><th>สถานะ</th><th>เข้าลาน</th></tr></thead>
          <tbody>{placements.map((row) => <tr key={row.placementId}>
            <td><b>{row.zoneCode}</b><small>{row.zoneName}</small></td>
            <td><Link href={`/app/motorcycles/${row.motorcycleId}`}><b>คันที่ {row.sequenceNumber}</b></Link><small>{row.jobNumber}</small></td>
            <td>{row.companyName}</td>
            <td>{[row.make, row.model].filter(Boolean).join(" · ") || "—"}<small>{row.registration || "ไม่มีทะเบียน"}</small></td>
            <td><span className="status-pill">{motorcycleStatusLabels[row.currentStatus]}</span></td>
            <td>{formatThaiDateTime(row.enteredAt)}</td>
          </tr>)}</tbody>
        </table></div></div> : <div className="app-panel app-empty"><div>🅿️</div><h2>ไม่มีรถอยู่ในลาน</h2><p>สแกน QR หรือเปิดรายละเอียดรถเพื่อบันทึกตำแหน่ง</p></div>}
        <nav className="batch-navigation" aria-label="หน้ารายการรถในลาน">
          <span>แสดงสูงสุด {YARD_PAGE_SIZE} รายการต่อหน้า</span>
          {hasMore && next && <Link className="button button-glass" href={`/app/yard?before=${encodeURIComponent(next.enteredAt)}&beforeId=${encodeURIComponent(next.placementId)}`}>หน้าถัดไป →</Link>}
          {!hasMore && placements.length > 0 && <span>ครบทุกตำแหน่งปัจจุบันแล้ว</span>}
        </nav>
      </section>
    </>
  );
}

function formatThaiDateTime(value: string): string {
  const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(date);
}
