/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- scoped overflow table is keyboard-focusable */
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { motorcycleImportBatches, motorcycleImportRows, transportJobs } from "@/db/schema";
import { can, isInternalRole } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";

export const dynamic = "force-dynamic";

export default async function MotorcycleImportDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; error?: string }> }) {
  const actor = await requireActor("/app/motorcycles/imports");
  if (!isInternalRole(actor.role)) redirect("/app/motorcycles");
  const { id } = await params;
  const query = await searchParams;
  const db = getDb();
  const batch = await db.select({ id: motorcycleImportBatches.id, jobId: motorcycleImportBatches.jobId, companyId: motorcycleImportBatches.companyId, filename: motorcycleImportBatches.sourceFilename, sourceType: motorcycleImportBatches.sourceType, checksum: motorcycleImportBatches.checksum, rowCount: motorcycleImportBatches.rowCount, validCount: motorcycleImportBatches.validCount, errorCount: motorcycleImportBatches.errorCount, status: motorcycleImportBatches.status, createdAt: motorcycleImportBatches.createdAt, importedAt: motorcycleImportBatches.importedAt, jobNumber: transportJobs.jobNumber }).from(motorcycleImportBatches).innerJoin(transportJobs, eq(transportJobs.id, motorcycleImportBatches.jobId)).where(eq(motorcycleImportBatches.id, id)).get();
  if (!batch || !can(actor, "motorcycles:write", batch.companyId)) notFound();
  const rows = await db.select().from(motorcycleImportRows).where(eq(motorcycleImportRows.batchId, id)).orderBy(asc(motorcycleImportRows.sourceRowNumber)).limit(500).all();
  return <>
    <header className="app-page-head"><div><p>IMPORT RECONCILIATION</p><h1>{batch.filename}</h1><span>{batch.jobNumber} · {batch.sourceType} · SHA-256 {batch.checksum.slice(0, 12)}…</span></div><Link className="button button-glass" href="/app/motorcycles/imports">ชุดนำเข้าทั้งหมด</Link></header>
    {query.status === "imported" && <div className="form-message success page-message">นำเข้า {batch.rowCount} คันแบบ Transaction สำเร็จแล้ว</div>}
    {query.status === "already_imported" && <div className="form-message success page-message">ชุดนี้ถูกนำเข้าสำเร็จแล้ว ระบบไม่สร้างข้อมูลซ้ำ</div>}
    {query.status === "file_exists" && <div className="form-message success page-message">ไฟล์เดียวกันเคยอัปโหลดแล้ว จึงเปิดผลตรวจเดิมแทน</div>}
    {query.error && <div className="form-message error page-message">{detailError(query.error)}</div>}
    <section className="import-summary-grid"><article className="app-panel"><span>ทั้งหมด</span><strong>{batch.rowCount}</strong></article><article className="app-panel"><span>ผ่าน</span><strong className="import-valid">{batch.validCount}</strong></article><article className="app-panel"><span>ผิดพลาด</span><strong className={batch.errorCount ? "import-error" : ""}>{batch.errorCount}</strong></article><article className="app-panel"><span>สถานะ</span><strong>{batch.status}</strong></article></section>
    {batch.status === "VALIDATED" && batch.errorCount === 0 && <section className="app-panel import-confirm"><div><h2>2. ยืนยันนำเข้าจริง</h2><p>ระบบจะสร้างรถ, สถานะเริ่มต้น และ Audit ทั้งชุดใน Transaction เดียว หากรายการใดล้มเหลวจะ Rollback ทั้งชุด</p></div><form action={`/api/motorcycles/imports/${batch.id}/confirm`} method="post"><input type="hidden" name="requestKey" value={crypto.randomUUID()} /><button className="button button-gradient" type="submit">ยืนยันนำเข้า {batch.rowCount} คัน</button></form></section>}
    {batch.status === "VALIDATED" && batch.errorCount > 0 && <div className="app-panel import-blocked"><h2>ยังนำเข้าไม่ได้</h2><p>แก้แถวที่ระบุในไฟล์ต้นฉบับ แล้วอัปโหลดเป็นไฟล์ใหม่ ระบบจะไม่เดาหรือข้ามข้อมูลที่ผิด</p></div>}
    <section className="data-card"><div className="data-table-wrap" tabIndex={0} role="region" aria-label="ผลตรวจรายการนำเข้า เลื่อนแนวนอนได้บนหน้าจอเล็ก"><table className="data-table import-preview-table"><thead><tr><th>แถว</th><th>รายละเอียด</th><th>ทะเบียน</th><th>VIN / เลขเครื่อง</th><th>ผลตรวจ</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.sourceRowNumber}</td><td>{[row.make, row.model, row.variant, row.modelYear, row.color].filter(Boolean).join(" · ") || "ยังไม่ระบุ"}<small>{row.vehicleCondition}</small></td><td>{row.registration || "—"}<small>{row.province || "—"}</small></td><td>{row.vin || "—"}<small>{row.engineNumber || "—"}</small></td><td>{row.validationStatus === "ERROR" ? <span className="import-error">{row.errorMessage}</span> : <span className="import-valid">{row.validationStatus === "IMPORTED" ? "นำเข้าแล้ว" : "พร้อมนำเข้า"}</span>}</td></tr>)}</tbody></table></div></section>
  </>;
}

function detailError(error: string): string { return ({ invalid_request: "คำขอยืนยันไม่ถูกต้อง", forbidden: "ไม่มีสิทธิ์นำเข้าชุดนี้", not_ready: "ชุดนี้ยังมีข้อผิดพลาดหรือสถานะไม่พร้อม", stale: "มีคำขออื่นดำเนินการชุดนี้แล้ว กรุณารีเฟรช", import_failed: "Transaction นำเข้าล้มเหลวและถูก Rollback ทั้งชุด" } as Record<string, string>)[error] ?? "ดำเนินการไม่สำเร็จ ไม่มีข้อมูลบางส่วนถูกสร้าง"; }
