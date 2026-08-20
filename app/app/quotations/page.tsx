import Link from "next/link";
import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { QUOTE_STATUSES, quoteRequestAttachments, quoteRequests } from "@/db/schema";
import { requireActor } from "@/lib/current-actor";

const PAGE_SIZE = 50;
type Props = { searchParams: Promise<{ status?: string; before?: string; beforeId?: string; result?: string }> };

export default async function QuotationsPage({ searchParams }: Props) {
  const actor = await requireActor("/app/quotations");
  if (actor.role !== "OWNER") redirect("/app");
  const params = await searchParams;
  const selectedStatus = QUOTE_STATUSES.includes(params.status as (typeof QUOTE_STATUSES)[number]) ? params.status as (typeof QUOTE_STATUSES)[number] : null;
  const cursor = params.before && params.beforeId ? or(lt(quoteRequests.createdAt, params.before), and(eq(quoteRequests.createdAt, params.before), lt(quoteRequests.id, params.beforeId))) : undefined;
  const rows = await getDb().select().from(quoteRequests).where(and(selectedStatus ? eq(quoteRequests.status, selectedStatus) : undefined, cursor)).orderBy(desc(quoteRequests.createdAt), desc(quoteRequests.id)).limit(PAGE_SIZE + 1).all();
  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = rows.slice(0, PAGE_SIZE);
  const attachmentRows = pageRows.length ? await getDb().select().from(quoteRequestAttachments).where(inArray(quoteRequestAttachments.quoteRequestId, pageRows.map((row) => row.id))).orderBy(asc(quoteRequestAttachments.createdAt), asc(quoteRequestAttachments.id)).all() : [];
  const attachmentsByRequest = new Map<string, typeof attachmentRows>();
  for (const attachment of attachmentRows) attachmentsByRequest.set(attachment.quoteRequestId, [...(attachmentsByRequest.get(attachment.quoteRequestId) ?? []), attachment]);
  const next = pageRows.at(-1);
  return <div className="app-page">
    <header className="app-page-head"><div><p>QUOTATION INBOX</p><h1>คำขอใบเสนอราคา</h1><span>ข้อมูลผู้ติดต่อเป็นข้อมูลภายใน แสดงเฉพาะบัญชี Owner และทุกการเปลี่ยนสถานะมี Audit Log</span></div></header>
    {params.result === "updated" && <div className="app-panel form-success" role="status">อัปเดตสถานะแล้ว</div>}
    {params.result === "error" && <div className="app-panel form-error" role="alert">อัปเดตไม่สำเร็จ กรุณาลองใหม่</div>}
    <nav className="trip-status-filters" aria-label="กรองสถานะคำขอ"><Link className={!selectedStatus ? "active" : ""} href="/app/quotations">ทั้งหมด</Link>{QUOTE_STATUSES.map((status) => <Link className={selectedStatus === status ? "active" : ""} href={`/app/quotations?status=${status}`} key={status}>{status}</Link>)}</nav>
    <div className="quotation-admin-list">{pageRows.map((row) => <article className="app-panel quotation-admin-card" key={row.id}>
      <header><div><span>{row.requestNumber}</span><h2>{row.contactName}</h2><small>{row.createdAt}</small></div><b>{row.status}</b></header>
      <dl><div><dt>บริษัท / หน่วยงาน</dt><dd>{row.companyName || "—"}</dd></div><div><dt>โทรศัพท์</dt><dd><a href={`tel:${row.phone}`}>{row.phone}</a></dd></div><div><dt>อีเมล</dt><dd>{row.email || "—"}</dd></div><div><dt>LINE ID</dt><dd>{row.lineId || "—"}</dd></div><div><dt>เส้นทาง</dt><dd>{row.origin} → {row.destination}</dd></div><div><dt>จำนวน / ประเภท</dt><dd>{row.quantity} คัน · {row.vehicleType || "ไม่ระบุ"}</dd></div><div><dt>วันที่ต้องการ</dt><dd>{row.desiredDate || "ยังไม่ระบุ"}</dd></div><div><dt>บริการเพิ่มเติม</dt><dd>{safeExtras(row.extrasJson)}</dd></div></dl>
      {row.notes && <p className="quotation-admin-notes">{row.notes}</p>}
      {(attachmentsByRequest.get(row.id)?.length ?? 0) > 0 && <section aria-label={`เอกสารประกอบ ${row.requestNumber}`}><h3>เอกสารประกอบ</h3><p className="quotation-attachment-warning">ไฟล์มาจากผู้ส่งภายนอก ระบบบังคับดาวน์โหลดและบันทึก Audit แต่ควรตรวจไฟล์ด้วยระบบความปลอดภัยของอุปกรณ์ก่อนเปิด</p><ul className="quotation-attachment-list">{attachmentsByRequest.get(row.id)!.map((attachment) => <li key={attachment.id}><a href={`/api/quotation/${row.id}/attachments/${attachment.id}`}><span>{attachment.originalFilename}</span><small>{formatBytes(attachment.byteSize)}</small></a></li>)}</ul></section>}
      <form className="quotation-status-form" action={`/api/quotation/${row.id}/status`} method="post"><label>สถานะ<select name="status" defaultValue={row.status}>{QUOTE_STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}</select></label><button className="button button-glass button-small" type="submit">บันทึกสถานะ</button></form>
    </article>)}</div>
    {!pageRows.length && <div className="app-panel app-empty"><h2>ยังไม่มีคำขอในสถานะนี้</h2><p>รายการจะปรากฏต่อเมื่อระบบบันทึกคำขอลงฐานข้อมูลสำเร็จ</p></div>}
    {hasMore && next && <nav className="batch-navigation"><span>แสดงครั้งละ {PAGE_SIZE} รายการ</span><Link className="button button-glass button-small" href={`/app/quotations?${selectedStatus ? `status=${selectedStatus}&` : ""}before=${encodeURIComponent(next.createdAt)}&beforeId=${encodeURIComponent(next.id)}`}>หน้าถัดไป</Link></nav>}
  </div>;
}

function safeExtras(value: string): string {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed.join(", ") || "—" : "—";
  } catch { return "—"; }
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
