import { and, desc, eq, lt, or } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { shippingContainers, CONTAINER_TYPES } from "@/db/schema";
import { can, isInternalRole } from "@/lib/authorization";
import { CONTAINER_PAGE_SIZE } from "@/lib/containers";
import { requireActor } from "@/lib/current-actor";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ status?: string; error?: string; before?: string; beforeId?: string }> };

export default async function ContainersPage({ searchParams }: Props) {
  const actor = await requireActor("/app/containers");
  if (!isInternalRole(actor.role) || !can(actor, "jobs:read")) redirect("/app");
  const query = await searchParams;
  const cursor = parseCursor(query.before, query.beforeId);
  if (cursor === null) notFound();
  const cursorFilter = cursor ? or(lt(shippingContainers.createdAt, cursor.createdAt), and(eq(shippingContainers.createdAt, cursor.createdAt), lt(shippingContainers.id, cursor.id))) : undefined;
  const rowsWithExtra = await getDb().select().from(shippingContainers).where(cursorFilter).orderBy(desc(shippingContainers.createdAt), desc(shippingContainers.id)).limit(CONTAINER_PAGE_SIZE + 1).all();
  const hasMore = rowsWithExtra.length > CONTAINER_PAGE_SIZE;
  const rows = rowsWithExtra.slice(0, CONTAINER_PAGE_SIZE);
  const next = rows.at(-1);
  const canWrite = can(actor, "jobs:write");

  return <>
    <div className="app-page-head"><div><p>EXPORT OPERATIONS</p><h1>ทะเบียนตู้คอนเทนเนอร์</h1><span>เลขตู้ ISO 6346, Seal, ประเภท, ท่าเรือและประเทศจากข้อมูลจริง</span></div></div>
    {query.status === "container_created" && <div className="form-message success page-message">สร้างทะเบียนตู้ในสถานะร่างแล้ว</div>}
    {query.status === "container_exists" && <div className="login-notice page-message">คำขอนี้สร้างทะเบียนตู้แล้ว ระบบไม่สร้างข้อมูลซ้ำ</div>}
    {query.error && <div className="form-message error page-message" role="alert">บันทึกไม่สำเร็จ กรุณาตรวจเลขตู้/check digit, ประเภท, ท่าเรือ, ประเทศ หรือเลขตู้ซ้ำ</div>}

    {canWrite && <form className="record-form" action="/api/containers" method="post">
      <input type="hidden" name="requestKey" value={crypto.randomUUID()} />
      <div className="field"><label htmlFor="containerNumber">Container No. (ISO 6346) *</label><input id="containerNumber" name="containerNumber" maxLength={20} placeholder="CSQU 305438-3" required /></div>
      <div className="field"><label htmlFor="sealNumber">Seal No.</label><input id="sealNumber" name="sealNumber" maxLength={50} /></div>
      <div className="field"><label htmlFor="containerType">ประเภท *</label><select id="containerType" name="type" required>{CONTAINER_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></div>
      <div className="field"><label htmlFor="containerCapacity">ความจุที่ยืนยันแล้ว (คัน)</label><input id="containerCapacity" name="capacityMotorcycles" type="number" min={1} max={1000} inputMode="numeric" /></div>
      <div className="field"><label htmlFor="containerPort">ท่าเรือ *</label><input id="containerPort" name="port" minLength={2} maxLength={100} required /></div>
      <div className="field"><label htmlFor="containerCountry">ประเทศปลายทาง *</label><input id="containerCountry" name="country" minLength={2} maxLength={100} required /></div>
      <div className="field full"><label htmlFor="containerNotes">หมายเหตุ</label><textarea id="containerNotes" name="notes" rows={3} maxLength={1000} /></div>
      <div className="full"><button className="button button-gradient" type="submit">สร้างทะเบียนตู้สถานะร่าง</button></div>
    </form>}

    <section className="detail-section"><div className="detail-section-head"><div><p>CONTAINER REGISTRY</p><h2>ตู้ล่าสุด</h2></div><span>{rows.length} รายการในหน้านี้</span></div>
      {rows.length ? <div className="container-grid">{rows.map((container) => <article className="app-panel container-card" key={container.id}><div><b>{container.containerNumber}</b><span className="status-pill">{container.status}</span></div><h2><Link href={`/app/containers/${container.id}`}>{container.type} · {container.port}</Link></h2><p>ปลายทาง {container.country}</p><dl><div><dt>Seal</dt><dd>{container.sealNumber || "ยังไม่ระบุ"}</dd></div><div><dt>ความจุ</dt><dd>{container.capacityMotorcycles ?? "ยังไม่ยืนยัน"} คัน</dd></div></dl><small>สร้าง {formatThaiDateTime(container.createdAt)}</small><Link className="button button-glass button-small" href={`/app/containers/${container.id}`}>เปิด Load Manifest</Link></article>)}</div> : <div className="app-panel app-empty"><div>🚢</div><h2>ยังไม่มีทะเบียนตู้</h2><p>เพิ่มเฉพาะเลขตู้จริงที่ผ่าน ISO 6346 check digit</p></div>}
      <nav className="batch-navigation" aria-label="หน้าทะเบียนตู้"><span>แสดงสูงสุด {CONTAINER_PAGE_SIZE} รายการต่อหน้า</span>{hasMore && next && <Link className="button button-glass button-small" href={`/app/containers?before=${encodeURIComponent(next.createdAt)}&beforeId=${encodeURIComponent(next.id)}`}>หน้าถัดไป</Link>}</nav>
    </section>
    <div className="login-notice page-message">Container Load Manifest บังคับความจุ, สถานะรถ, Seal และ Audit จริง ระบบไม่ข้ามสถานะรถให้อัตโนมัติ</div>
  </>;
}

function parseCursor(createdAt?: string, id?: string): { createdAt: string; id: string } | undefined | null {
  if (!createdAt && !id) return undefined;
  if (!createdAt || !id || id.length > 100 || Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
}

function formatThaiDateTime(value: string): string {
  const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(date);
}
