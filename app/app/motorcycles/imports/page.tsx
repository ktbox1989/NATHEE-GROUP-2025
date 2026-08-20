/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- scoped overflow table is keyboard-focusable */
import Link from "next/link";
import { asc, desc, eq, notInArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { companies, motorcycleImportBatches, transportJobs } from "@/db/schema";
import { can, isInternalRole } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";

export const dynamic = "force-dynamic";

export default async function MotorcycleImportsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await requireActor("/app/motorcycles/imports");
  if (!isInternalRole(actor.role) || !can(actor, "motorcycles:write")) redirect("/app/motorcycles");
  const { error } = await searchParams;
  const db = getDb();
  const [jobs, batches] = await Promise.all([
    db.select({ id: transportJobs.id, jobNumber: transportJobs.jobNumber, companyName: companies.displayName }).from(transportJobs).innerJoin(companies, eq(companies.id, transportJobs.companyId)).where(notInArray(transportJobs.status, ["COMPLETED", "CANCELLED"])).orderBy(asc(transportJobs.jobNumber)).limit(500).all(),
    db.select({ id: motorcycleImportBatches.id, filename: motorcycleImportBatches.sourceFilename, sourceType: motorcycleImportBatches.sourceType, rowCount: motorcycleImportBatches.rowCount, validCount: motorcycleImportBatches.validCount, errorCount: motorcycleImportBatches.errorCount, status: motorcycleImportBatches.status, createdAt: motorcycleImportBatches.createdAt, jobNumber: transportJobs.jobNumber }).from(motorcycleImportBatches).innerJoin(transportJobs, eq(transportJobs.id, motorcycleImportBatches.jobId)).orderBy(desc(motorcycleImportBatches.createdAt), desc(motorcycleImportBatches.id)).limit(50).all(),
  ]);
  return <>
    <header className="app-page-head"><div><p>BULK MOTORCYCLE IMPORT</p><h1>นำเข้ารถจำนวนมาก</h1><span>ตรวจทุกรายการก่อนยืนยัน รองรับ CSV และ XLSX สูงสุด 500 คันต่อชุด</span></div><Link className="button button-glass" href="/app/motorcycles">กลับรายการรถ</Link></header>
    {error && <div className="form-message error page-message">{importError(error)}</div>}
    <section className="app-panel import-guide"><div><h2>1. เตรียมไฟล์มาตรฐาน</h2><p>หนึ่งแถวต่อหนึ่งคัน ต้องมี VIN/เลขโครงหรือเลขเครื่องอย่างน้อยหนึ่งค่า ไม่ใส่สูตรใน Excel</p></div><Link className="button button-glass" href="/api/motorcycles/imports/template">ดาวน์โหลด CSV Template</Link></section>
    <form className="record-form import-upload-form" action="/api/motorcycles/imports" method="post" encType="multipart/form-data">
      <input type="hidden" name="requestKey" value={crypto.randomUUID()} />
      <div className="field full"><label htmlFor="jobId">งานขนส่ง *</label><select id="jobId" name="jobId" required><option value="">เลือก Job</option>{jobs.map((job) => <option value={job.id} key={job.id}>{job.jobNumber} · {job.companyName}</option>)}</select></div>
      <div className="field full"><label htmlFor="file">ไฟล์ CSV หรือ XLSX *</label><input id="file" name="file" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /><small>CSV ไม่เกิน 2 MB · XLSX ไม่เกิน 5 MB · 1–500 รายการ</small></div>
      <div className="full"><button className="button button-gradient" type="submit">อัปโหลดและตรวจสอบ</button></div>
    </form>
    <section className="data-card"><div className="app-page-head compact"><div><h2>ประวัติชุดนำเข้า</h2><span>เก็บผลตรวจและ Audit ไว้เพื่อ Reconciliation</span></div></div>{batches.length ? <div className="data-table-wrap" tabIndex={0} role="region" aria-label="ประวัติชุดนำเข้า เลื่อนแนวนอนได้บนหน้าจอเล็ก"><table className="data-table"><thead><tr><th>ไฟล์ / Job</th><th>รายการ</th><th>ผลตรวจ</th><th>สถานะ</th><th>วันที่</th></tr></thead><tbody>{batches.map((batch) => <tr key={batch.id}><td><Link href={`/app/motorcycles/imports/${batch.id}`}><b>{batch.filename}</b></Link><small>{batch.jobNumber} · {batch.sourceType}</small></td><td>{batch.rowCount}</td><td><span className="import-valid">ผ่าน {batch.validCount}</span><small className={batch.errorCount ? "import-error" : ""}>ผิดพลาด {batch.errorCount}</small></td><td><span className={`status-pill ${batch.status}`}>{batch.status}</span></td><td>{new Date(batch.createdAt).toLocaleString("th-TH")}</td></tr>)}</tbody></table></div> : <div className="app-empty"><div>📄</div><h2>ยังไม่มีชุดนำเข้า</h2><p>อัปโหลดไฟล์เพื่อเริ่มตรวจสอบ โดยระบบยังไม่สร้างรถจนกว่าจะกดยืนยัน</p></div>}</section>
  </>;
}

function importError(error: string): string {
  return ({ invalid_request: "คำขอไม่ถูกต้อง กรุณาเปิดหน้าใหม่แล้วลองอีกครั้ง", invalid_file: "ไฟล์ไม่ผ่านการตรวจชนิด ขนาด โครงสร้าง หรือข้อมูล", job: "Job ไม่พร้อมใช้งานหรือคุณไม่มีสิทธิ์", save: "บันทึกชุดตรวจสอบไม่สำเร็จ ไม่มีรถถูกสร้าง" } as Record<string, string>)[error] ?? "ดำเนินการไม่สำเร็จ ไม่มีรถถูกสร้าง";
}
