import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { yardZones } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { getZoneCapacity, getZoneMap } from "@/lib/yard-location";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
};

const ERRORS: Record<string, string> = {
  invalid_row: "ข้อมูลแถวไม่ถูกต้อง",
  duplicate_row: "รหัสแถวนี้มีอยู่แล้วในโซนนี้",
  invalid_slot: "ข้อมูลช่องจอดไม่ถูกต้อง",
  slot_rejected: "สร้างช่องจอดไม่ได้ อาจเป็นรหัสซ้ำ หรือโซนนี้ยังกำหนดความจุด้วยมืออยู่",
  slot_occupied: "ช่องนี้มีรถจอดอยู่ ย้ายรถออกก่อนจึงจะปิดช่องได้",
};

const STATUSES: Record<string, string> = {
  row_created: "เพิ่มแถวแล้ว",
  slots_created: "เพิ่มช่องจอดแล้ว",
  slot_updated: "อัปเดตสถานะช่องจอดแล้ว",
};

export default async function YardZoneMapPage({ params, searchParams }: Props) {
  const actor = await requireActor("/app/yard");
  if (!can(actor, "yard:read")) redirect("/app");
  const { id: zoneId } = await params;
  const query = await searchParams;

  const zone = await getDb()
    .select({ id: yardZones.id, code: yardZones.code, name: yardZones.name, status: yardZones.status, capacity: yardZones.capacity })
    .from(yardZones)
    .where(eq(yardZones.id, zoneId))
    .get();
  if (!zone) notFound();

  const [capacity, rows] = await Promise.all([getZoneCapacity(zoneId), getZoneMap(zoneId)]);
  const canWrite = can(actor, "yard:write");

  return (
    <>
      <div className="app-page-head">
        <div>
          <p>YARD MAP</p>
          <h1>{zone.code} · {zone.name}</h1>
          <span>
            {capacity?.source === "SLOTS"
              ? `ความจุคำนวณจากช่องจอดจริง ${capacity.total} ช่อง · ใช้อยู่ ${capacity.occupied} · ว่าง ${capacity.available}`
              : capacity?.source === "MANUAL"
                ? `ความจุกำหนดด้วยมือ ${capacity.total} คัน · ใช้อยู่ ${capacity.occupied} — เพิ่มช่องจอดเพื่อให้ความจุมาจากของจริง`
                : `ยังไม่จำกัดความจุ · ใช้อยู่ ${capacity?.occupied ?? 0}`}
          </span>
        </div>
        <Link className="button button-glass" href="/app/yard">กลับไปรายการโซน</Link>
      </div>

      {query.error && <p className="form-error">{ERRORS[query.error] ?? "ดำเนินการไม่สำเร็จ"}</p>}
      {query.status && <p className="form-message">{STATUSES[query.status] ?? query.status}</p>}

      {rows.length === 0 ? (
        <section className="app-panel app-empty">
          <h2>โซนนี้ยังไม่ได้แบ่งแถวและช่องจอด</h2>
          <p>
            ตอนนี้รถจะจอดโดยระบุแค่โซน เมื่อเพิ่มช่องจอดแล้ว ระบบจะบังคับให้ระบุช่องที่แน่นอนทุกครั้ง
            และความจุจะนับจากช่องจริงแทนตัวเลขที่กรอกเอง
          </p>
        </section>
      ) : (
        <section className="yard-map">
          {rows.map((row) => (
            <article className="app-panel yard-map-row" key={row.rowId}>
              <header>
                <h2>แถว {row.rowCode}{row.rowName ? ` · ${row.rowName}` : ""}</h2>
                <span className={`status-pill ${row.status}`}>{row.status}</span>
              </header>
              <ol className="yard-slot-grid">
                {row.slots.map((slot) => (
                  <li key={slot.slotId} className={`yard-slot yard-slot-${slot.status}${slot.occupantMotorcycleId ? " yard-slot-occupied" : ""}`}>
                    <b>{slot.slotCode}</b>
                    {slot.occupantMotorcycleId ? (
                      <Link href={`/app/motorcycles/${slot.occupantMotorcycleId}`}>{slot.occupantPublicId}</Link>
                    ) : (
                      <small>{slot.status === "ACTIVE" ? "ว่าง" : slot.status}</small>
                    )}
                    {canWrite && !slot.occupantMotorcycleId && (
                      <form action={`/api/yard/slots/${slot.slotId}/status`} method="post">
                        <input type="hidden" name="status" value={slot.status === "ACTIVE" ? "BLOCKED" : "ACTIVE"} />
                        <button type="submit">{slot.status === "ACTIVE" ? "ปิดช่อง" : "เปิดช่อง"}</button>
                      </form>
                    )}
                  </li>
                ))}
                {row.slots.length === 0 && <li className="yard-slot"><small>ยังไม่มีช่องจอด</small></li>}
              </ol>
              {canWrite && (
                <form className="record-form" action="/api/yard/slots" method="post">
                  <input type="hidden" name="rowId" value={row.rowId} />
                  <div className="field">
                    <label htmlFor={`codes-${row.rowId}`}>เพิ่มช่องจอด (เช่น 01-20 หรือ 21)</label>
                    <input id={`codes-${row.rowId}`} name="codes" maxLength={20} required placeholder="01-20" />
                  </div>
                  <button className="button button-glass" type="submit">เพิ่มช่องจอด</button>
                </form>
              )}
            </article>
          ))}
        </section>
      )}

      {canWrite && (
        <section className="app-panel">
          <h2>เพิ่มแถวใหม่</h2>
          {zone.capacity !== null && (
            <p>
              โซนนี้ยังกำหนดความจุด้วยมือไว้ที่ {zone.capacity} คัน
              ต้องล้างค่านั้นก่อนจึงจะเพิ่มช่องจอดได้ เพื่อไม่ให้มีตัวเลขความจุสองแหล่ง
            </p>
          )}
          <form className="record-form" action="/api/yard/rows" method="post">
            <input type="hidden" name="zoneId" value={zone.id} />
            <div className="field"><label htmlFor="code">รหัสแถว</label><input id="code" name="code" maxLength={20} required placeholder="R1" /></div>
            <div className="field"><label htmlFor="name">ชื่อแถว (ไม่บังคับ)</label><input id="name" name="name" maxLength={120} /></div>
            <div className="field"><label htmlFor="sortOrder">ลำดับ</label><input id="sortOrder" name="sortOrder" type="number" min={0} defaultValue={rows.length} /></div>
            <button className="button button-gradient" type="submit">เพิ่มแถว</button>
          </form>
        </section>
      )}
    </>
  );
}
