import { and, isNotNull, ne, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import {
  companies,
  motorcycles,
  shippingContainers,
  transportJobs,
  trips,
  trucks,
  yardZones,
} from "@/db/schema";
import { can, isInternalRole, type Actor } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import {
  normalizePrintCenterSearch,
  parsePrintCenterKind,
  PRINT_CENTER_KIND_LABELS,
  PRINT_CENTER_PAGE_SIZE,
  PRINT_CENTER_SEARCH_KINDS,
  type PrintCenterSearchKind,
} from "@/lib/print-center";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ kind?: string; q?: string }> };
type PrintRecord = {
  id: string;
  title: string;
  subtitle: string;
  detail: string;
  companyId?: string;
};

export default async function PrintCenterPage({ searchParams }: Props) {
  const actor = await requireActor("/app/print-center");
  if (!isInternalRole(actor.role) || !can(actor, "documents:read")) redirect("/app");

  const params = await searchParams;
  const kind = parsePrintCenterKind(params.kind);
  if (!kind) notFound();
  const query = normalizePrintCenterSearch(params.q ?? "");
  const recordsWithExtra = typeof query === "string" ? await searchPrintRecords(kind, query) : [];
  const truncated = recordsWithExtra.length > PRINT_CENTER_PAGE_SIZE;
  const records = recordsWithExtra.slice(0, PRINT_CENTER_PAGE_SIZE);

  return <>
    <div className="app-page-head">
      <div><p>REAL DATA PRINT HUB</p><h1>ศูนย์พิมพ์เอกสาร</h1><span>ค้นจากข้อมูลจริง แล้วเปิดฉลากหรือเอกสารที่ระบบตรวจสิทธิ์อีกครั้งก่อนพิมพ์</span></div>
    </div>

    <section className="app-panel print-center-intro">
      <div><b>พร้อมใช้งาน</b><p>QR รถรายคัน · QR รถทั้ง Job ชุดละ {48} · QR Job · QR ลาน · QR รถขนส่ง · QR เที่ยว · ใบตรวจสภาพและ POD · Trip/Container Load Board</p></div>
      <div><b>ยังไม่อ้างว่าใช้งานจริง</b><p>Invoice และรายงานการเงินยังไม่มี Backend/เลขเอกสารที่ยืนยัน จึงไม่สร้างเอกสารจำลองจากหน้านี้</p></div>
    </section>

    <form className="print-center-search" action="/app/print-center" method="get" role="search">
      <label htmlFor="print-kind">ประเภทเอกสาร<select id="print-kind" name="kind" defaultValue={kind}>{PRINT_CENTER_SEARCH_KINDS.map((value) => <option value={value} key={value}>{PRINT_CENTER_KIND_LABELS[value]}</option>)}</select></label>
      <label htmlFor="print-query">ค้นหาแบบขึ้นต้นด้วย<input id="print-query" name="q" minLength={2} maxLength={80} required defaultValue={params.q ?? ""} placeholder={placeholderFor(kind)} autoComplete="off" /></label>
      <button className="button button-gradient" type="submit">ค้นหาเอกสาร</button>
    </form>

    {query === undefined && <div className="form-message error page-message" role="alert">คำค้นต้องยาว 2–80 ตัวอักษร และห้ามมี wildcard หรือ control character</div>}
    {query === null && <div className="app-panel app-empty"><div>⌕</div><h2>ค้นหาเอกสารที่ต้องพิมพ์</h2><p>เลือกประเภทและระบุเลขอ้างอิงจริงอย่างน้อย 2 ตัวอักษร ระบบจะไม่โหลดข้อมูลทั้งหมดโดยไม่มีขอบเขต</p></div>}
    {typeof query === "string" && <PrintResults kind={kind} query={query} records={records} actor={actor} />}
    {truncated && <div className="login-notice page-message">พบมากกว่า {PRINT_CENTER_PAGE_SIZE} รายการ กรุณาระบุเลขอ้างอิงให้เจาะจงขึ้น</div>}
  </>;
}

function PrintResults({ kind, query, records, actor }: { kind: PrintCenterSearchKind; query: string; records: PrintRecord[]; actor: Actor }) {
  return <section className="detail-section">
    <div className="detail-section-head"><div><p>SEARCH RESULTS</p><h2>{PRINT_CENTER_KIND_LABELS[kind]}</h2></div><span>{records.length} รายการ · “{query}”</span></div>
    {records.length ? <div className="print-center-results">{records.map((record) => <article className="app-panel print-center-result" key={record.id}>
      <div><h3>{record.title}</h3><span>{record.subtitle}</span><p>{record.detail}</p></div>
      <div className="print-center-actions">{actionsFor(kind, record, actor)}</div>
    </article>)}</div> : <div className="app-panel app-empty"><div>∅</div><h2>ไม่พบข้อมูลจริง</h2><p>ตรวจเลขอ้างอิงหรือเลือกประเภทการค้นหาใหม่ ระบบไม่สร้างผลลัพธ์ตัวอย่าง</p></div>}
  </section>;
}

function actionsFor(kind: PrintCenterSearchKind, record: PrintRecord, actor: Actor) {
  if (kind === "job") {
    const canPrintJob = can(actor, "jobs:write", record.companyId);
    const canPrintVehicles = can(actor, "motorcycles:write", record.companyId);
    if (!canPrintJob && !canPrintVehicles) return <span>ไม่มีสิทธิ์พิมพ์ฉลากงานนี้</span>;
    return <>{canPrintJob && <Link href={`/app/jobs/${record.id}/label`}>QR Job</Link>}{canPrintVehicles && <Link href={`/app/jobs/${record.id}/labels`}>QR รถทั้ง Job</Link>}</>;
  }
  if (kind.startsWith("motorcycle-")) return <>
    {can(actor, "motorcycles:write", record.companyId) && <Link href={`/app/motorcycles/${record.id}/label`}>QR รถ</Link>}
    {can(actor, "documents:read", record.companyId) && <Link href={`/app/motorcycles/${record.id}/documents`}>Inspection / POD</Link>}
  </>;
  if (kind === "yard") return can(actor, "yard:write") ? <Link href={`/app/yard/${record.id}/label`}>QR โซน</Link> : <span>ไม่มีสิทธิ์พิมพ์ QR โซน</span>;
  if (kind === "truck") return can(actor, "jobs:write") ? <Link href={`/app/trucks/${record.id}/label`}>QR รถขนส่ง</Link> : <span>ไม่มีสิทธิ์พิมพ์ QR รถขนส่ง</span>;
  if (kind === "trip") return <><Link href={`/app/trips/${record.id}`}>Trip list / Load Board</Link>{can(actor, "jobs:write") && <Link href={`/app/trips/${record.id}/label`}>QR เที่ยว</Link>}</>;
  return <Link href={`/app/containers/${record.id}`}>Container Load Manifest</Link>;
}

async function searchPrintRecords(kind: PrintCenterSearchKind, query: string): Promise<PrintRecord[]> {
  const db = getDb();
  const glob = `${query}*`;
  const limit = PRINT_CENTER_PAGE_SIZE + 1;
  if (kind === "job") return db.select({ id: transportJobs.id, title: transportJobs.jobNumber, subtitle: companies.displayName, detail: sql<string>`${transportJobs.origin} || ' → ' || ${transportJobs.destination}`, companyId: transportJobs.companyId }).from(transportJobs).innerJoin(companies, sql`${companies.id} = ${transportJobs.companyId}`).where(sql`${transportJobs.jobNumber} GLOB ${glob}`).orderBy(transportJobs.jobNumber).limit(limit).all();
  if (kind.startsWith("motorcycle-")) {
    const field = kind === "motorcycle-registration" ? motorcycles.registration : kind === "motorcycle-vin" ? motorcycles.vin : motorcycles.engineNumber;
    const filter = kind === "motorcycle-registration"
      ? sql`${field} GLOB ${glob}`
      : and(isNotNull(field), ne(field, ""), sql`${field} GLOB ${glob}`);
    const rows = await db.select({ id: motorcycles.id, sequence: motorcycles.sequenceNumber, make: motorcycles.make, model: motorcycles.model, registration: motorcycles.registration, jobNumber: transportJobs.jobNumber, companyName: companies.displayName, companyId: motorcycles.companyId }).from(motorcycles).innerJoin(transportJobs, sql`${transportJobs.id} = ${motorcycles.jobId}`).innerJoin(companies, sql`${companies.id} = ${motorcycles.companyId}`).where(filter).orderBy(field).limit(limit).all();
    return rows.map((row) => ({ id: row.id, title: `${row.jobNumber} · คันที่ ${row.sequence}`, subtitle: row.companyName, detail: `${[row.make, row.model].filter(Boolean).join(" ") || "ไม่ระบุรุ่น"} · ${row.registration || "ไม่มีทะเบียน"}`, companyId: row.companyId }));
  }
  if (kind === "yard") return db.select({ id: yardZones.id, title: yardZones.code, subtitle: yardZones.name, detail: yardZones.status }).from(yardZones).where(sql`${yardZones.code} GLOB ${glob}`).orderBy(yardZones.code).limit(limit).all();
  if (kind === "truck") {
    const rows = await db.select({ id: trucks.id, code: trucks.code, registration: trucks.registration, type: trucks.type, status: trucks.status }).from(trucks).where(sql`${trucks.code} GLOB ${glob}`).orderBy(trucks.code).limit(limit).all();
    return rows.map((row) => ({ id: row.id, title: row.code, subtitle: row.registration || "ยังไม่มีทะเบียน", detail: `${row.type} · ${row.status}` }));
  }
  if (kind === "trip") {
    const rows = await db.select({ id: trips.id, number: trips.tripNumber, origin: trips.origin, destination: trips.destination, status: trips.status }).from(trips).where(sql`${trips.tripNumber} GLOB ${glob}`).orderBy(trips.tripNumber).limit(limit).all();
    return rows.map((row) => ({ id: row.id, title: row.number, subtitle: `${row.origin} → ${row.destination}`, detail: row.status }));
  }
  const rows = await db.select({ id: shippingContainers.id, number: shippingContainers.containerNumber, port: shippingContainers.port, country: shippingContainers.country, status: shippingContainers.status }).from(shippingContainers).where(sql`${shippingContainers.containerNumber} GLOB ${glob}`).orderBy(shippingContainers.containerNumber).limit(limit).all();
  return rows.map((row) => ({ id: row.id, title: row.number, subtitle: `${row.port} → ${row.country}`, detail: row.status }));
}

function placeholderFor(kind: PrintCenterSearchKind): string {
  if (kind === "job") return "เช่น JOB-2026-";
  if (kind === "yard") return "เช่น A-01";
  if (kind === "truck") return "เช่น NG-01";
  if (kind === "trip") return "เช่น TRIP-2026-";
  if (kind === "container") return "เช่น CSQU";
  return kind === "motorcycle-registration" ? "ทะเบียนรถ" : kind === "motorcycle-vin" ? "VIN" : "เลขเครื่อง";
}
