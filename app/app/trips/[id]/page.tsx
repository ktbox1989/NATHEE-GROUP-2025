import { and, asc, count, eq, gt, isNull, or, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import {
  companies,
  motorcycles,
  transportJobs,
  tripMotorcycleAssignments,
  trips,
  tripStatusEvents,
  trucks,
  users,
} from "@/db/schema";
import { can, isInternalRole } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { motorcycleStatusLabels } from "@/lib/labels";
import { allowedTripTransitions, normalizeLoadBoardSearch, tripReadinessIssue } from "@/lib/trips";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const tripStatusLabels = {
  DRAFT: "ร่าง",
  PLANNED: "วางแผนแล้ว",
  LOADING: "กำลังขึ้นรถ",
  IN_TRANSIT: "กำลังขนส่ง",
  ARRIVED: "ถึงปลายทาง",
  COMPLETED: "เสร็จสิ้น",
  CANCELLED: "ยกเลิก",
} as const;
const assignmentLabels = {
  ASSIGNED: "จัดเข้าเที่ยวแล้ว",
  LOADED: "ยืนยันขึ้นรถแล้ว",
  UNLOADED: "ยืนยันลงรถแล้ว",
  RELEASED: "ปิดรายการแล้ว",
} as const;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; error?: string; after?: string; afterId?: string; motorcycleQ?: string }>;
};

export default async function TripDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const actor = await requireActor(`/app/trips/${id}`);
  if (!isInternalRole(actor.role) || !can(actor, "jobs:read")) redirect("/app");
  const cursor = parseCursor(query.after, query.afterId);
  if (cursor === null) notFound();
  const motorcycleSearch = normalizeLoadBoardSearch(query.motorcycleQ ?? "");
  if (motorcycleSearch === undefined) notFound();

  const db = getDb();
  const trip = await db
    .select({
      id: trips.id,
      tripNumber: trips.tripNumber,
      status: trips.status,
      origin: trips.origin,
      destination: trips.destination,
      notes: trips.notes,
      plannedDepartureAt: trips.plannedDepartureAt,
      plannedArrivalAt: trips.plannedArrivalAt,
      actualDepartureAt: trips.actualDepartureAt,
      actualArrivalAt: trips.actualArrivalAt,
      truckCode: trucks.code,
      truckRegistration: trucks.registration,
      truckCapacity: trucks.capacityMotorcycles,
      driverName: users.displayName,
    })
    .from(trips)
    .innerJoin(trucks, eq(trucks.id, trips.truckId))
    .leftJoin(users, eq(users.id, trips.driverUserId))
    .where(eq(trips.id, id))
    .get();
  if (!trip) notFound();

  const cursorFilter = cursor
    ? or(
        gt(tripMotorcycleAssignments.assignedAt, cursor.assignedAt),
        and(eq(tripMotorcycleAssignments.assignedAt, cursor.assignedAt), gt(tripMotorcycleAssignments.id, cursor.id)),
      )
    : undefined;
  const canManage = can(actor, "jobs:write") && can(actor, "motorcycles:write");
  const [assignmentRows, readinessRows, statusEvents, totalRow] = await Promise.all([
    db
      .select({
        id: tripMotorcycleAssignments.id,
        motorcycleId: motorcycles.id,
        state: tripMotorcycleAssignments.state,
        assignedAt: tripMotorcycleAssignments.assignedAt,
        releaseReason: tripMotorcycleAssignments.releaseReason,
        motorcycleStatus: motorcycles.currentStatus,
        sequenceNumber: motorcycles.sequenceNumber,
        make: motorcycles.make,
        model: motorcycles.model,
        color: motorcycles.color,
        registration: motorcycles.registration,
        jobNumber: transportJobs.jobNumber,
        companyName: companies.displayName,
      })
      .from(tripMotorcycleAssignments)
      .innerJoin(motorcycles, eq(motorcycles.id, tripMotorcycleAssignments.motorcycleId))
      .innerJoin(transportJobs, eq(transportJobs.id, motorcycles.jobId))
      .innerJoin(companies, eq(companies.id, motorcycles.companyId))
      .where(and(eq(tripMotorcycleAssignments.tripId, id), cursorFilter))
      .orderBy(asc(tripMotorcycleAssignments.assignedAt), asc(tripMotorcycleAssignments.id))
      .limit(PAGE_SIZE + 1)
      .all(),
    db
      .select({ state: tripMotorcycleAssignments.state, motorcycleStatus: motorcycles.currentStatus })
      .from(tripMotorcycleAssignments)
      .innerJoin(motorcycles, eq(motorcycles.id, tripMotorcycleAssignments.motorcycleId))
      .where(and(eq(tripMotorcycleAssignments.tripId, id), isNull(tripMotorcycleAssignments.releasedAt)))
      .limit(1000)
      .all(),
    db
      .select({ id: tripStatusEvents.id, previousStatus: tripStatusEvents.previousStatus, newStatus: tripStatusEvents.newStatus, note: tripStatusEvents.note, createdAt: tripStatusEvents.createdAt, actorName: users.displayName })
      .from(tripStatusEvents)
      .innerJoin(users, eq(users.id, tripStatusEvents.createdBy))
      .where(eq(tripStatusEvents.tripId, id))
      .orderBy(asc(tripStatusEvents.createdAt))
      .limit(100)
      .all(),
    db.select({ total: count() }).from(tripMotorcycleAssignments).where(eq(tripMotorcycleAssignments.tripId, id)).get(),
  ]);
  const hasMore = assignmentRows.length > PAGE_SIZE;
  const rows = assignmentRows.slice(0, PAGE_SIZE);
  const next = rows.at(-1);
  const activeCount = readinessRows.length;
  const effectiveCapacity = trip.truckCapacity ?? 1000;
  const capacityAvailable = activeCount < effectiveCapacity;
  const assignableTrip = ["DRAFT", "PLANNED"].includes(trip.status);

  const eligibleRows = canManage && assignableTrip && capacityAvailable
    ? await db
        .select({
          id: motorcycles.id,
          sequenceNumber: motorcycles.sequenceNumber,
          make: motorcycles.make,
          model: motorcycles.model,
          registration: motorcycles.registration,
          jobNumber: transportJobs.jobNumber,
          companyName: companies.displayName,
        })
        .from(motorcycles)
        .innerJoin(transportJobs, eq(transportJobs.id, motorcycles.jobId))
        .innerJoin(companies, eq(companies.id, motorcycles.companyId))
        .leftJoin(
          tripMotorcycleAssignments,
          and(eq(tripMotorcycleAssignments.motorcycleId, motorcycles.id), isNull(tripMotorcycleAssignments.releasedAt)),
        )
        .where(and(
          eq(motorcycles.currentStatus, "SCHEDULED"),
          isNull(tripMotorcycleAssignments.id),
          motorcycleSearch
            ? or(
                sql`${transportJobs.jobNumber} GLOB ${`${motorcycleSearch.toUpperCase()}*`}`,
                sql`${motorcycles.publicId} GLOB ${`${motorcycleSearch.toLowerCase()}*`}`,
                sql`${motorcycles.registration} GLOB ${`${motorcycleSearch}*`}`,
              )
            : undefined,
        ))
        .orderBy(asc(transportJobs.jobNumber), asc(motorcycles.sequenceNumber))
        .limit(101)
        .all()
    : [];
  const eligibleTruncated = eligibleRows.length > 100;
  const eligible = eligibleRows.slice(0, 100);
  const nextStatuses = allowedTripTransitions(trip.status);

  return (
    <>
      <div className="app-page-head">
        <div><p>{trip.tripNumber}</p><h1>{trip.origin} → {trip.destination}</h1><span>{trip.truckCode} · {trip.truckRegistration || "ยังไม่มีทะเบียน"} · {trip.driverName || "ยังไม่กำหนดคนขับ"}</span></div>
        <div className="app-page-actions"><Link href="/app/trips">← กลับรายการเที่ยว</Link><span className={`status-pill ${trip.status}`}>{tripStatusLabels[trip.status]}</span></div>
      </div>
      <Messages status={query.status} error={query.error} />

      <section className="trip-overview-grid">
        <article className="app-panel trip-capacity-card">
          <p>LOAD CAPACITY</p><strong>{activeCount}<small> / {trip.truckCapacity ?? "สูงสุด 1,000*"} คัน</small></strong>
          <span>{capacityAvailable ? (trip.truckCapacity === null ? "ยังไม่ยืนยันความจุจริง · ระบบจำกัดสูงสุด 1,000" : "ยังเพิ่มรถเข้าเที่ยวได้") : "เต็มความจุที่กำหนด"}</span>
        </article>
        <article className="app-panel trip-time-card"><p>กำหนดออก</p><strong>{formatThaiDateTime(trip.plannedDepartureAt)}</strong><span>ออกจริง {formatThaiDateTime(trip.actualDepartureAt)}</span></article>
        <article className="app-panel trip-time-card"><p>กำหนดถึง</p><strong>{formatThaiDateTime(trip.plannedArrivalAt)}</strong><span>ถึงจริง {formatThaiDateTime(trip.actualArrivalAt)}</span></article>
      </section>

      {canManage && assignableTrip && capacityAvailable && (
        <section className="detail-section">
          <div className="detail-section-head"><div><p>ASSIGN MOTORCYCLE</p><h2>จัดรถเข้าเที่ยว</h2></div><span>เฉพาะรถสถานะ “รอขึ้นรถ” ที่ยังไม่อยู่เที่ยวอื่น</span></div>
          <form className="trip-load-search" action={`/app/trips/${id}`} method="get" role="search">
            <label htmlFor="motorcycleQ">ค้นหาด้วยเลข Job, Public ID หรือทะเบียน (ขึ้นต้นด้วย)</label>
            <div><input id="motorcycleQ" name="motorcycleQ" minLength={2} maxLength={50} defaultValue={motorcycleSearch ?? ""} placeholder="เช่น JOB-2026 หรือ 1กข" /><button type="submit">ค้นหา</button>{motorcycleSearch && <Link href={`/app/trips/${id}`}>ล้างการค้นหา</Link>}</div>
          </form>
          {eligible.length ? (
            <form className="app-panel trip-assign-form" action={`/api/trips/${id}/assignments`} method="post">
              <input type="hidden" name="requestKey" value={crypto.randomUUID()} />
              <div className="field"><label htmlFor="motorcycleId">รถจักรยานยนต์</label><select id="motorcycleId" name="motorcycleId" required><option value="">เลือกรถ</option>{eligible.map((motorcycle) => <option key={motorcycle.id} value={motorcycle.id}>{motorcycle.jobNumber} · คันที่ {motorcycle.sequenceNumber} · {[motorcycle.make, motorcycle.model, motorcycle.registration].filter(Boolean).join(" / ") || "ยังไม่ระบุรายละเอียด"} · {motorcycle.companyName}</option>)}</select></div>
              <button className="button button-gradient button-small" type="submit">จัดเข้าเที่ยว</button>
              {eligibleTruncated && <p>พบมากกว่า 100 รายการ กรุณาค้นหาด้วยเลข Job, Public ID หรือทะเบียนให้แคบลง</p>}
            </form>
          ) : <div className="app-panel app-empty"><div>🏍️</div><h2>{motorcycleSearch ? "ไม่พบรถตรงกับคำค้น" : "ไม่มีรถที่พร้อมจัดเที่ยว"}</h2><p>{motorcycleSearch ? "ตรวจเลข Job, Public ID หรือทะเบียน แล้วค้นหาอีกครั้ง" : "รถต้องผ่านขั้นตอนเดิมจนถึงสถานะ “รอขึ้นรถ” ก่อน ระบบจะไม่ข้ามสถานะให้อัตโนมัติ"}</p></div>}
        </section>
      )}

      <section className="detail-section">
        <div className="detail-section-head"><div><p>LOAD BOARD</p><h2>รถจักรยานยนต์ในเที่ยว</h2></div><span>{totalRow?.total ?? 0} รายการรวมประวัติ · หน้าละ {PAGE_SIZE}</span></div>
        {rows.length ? <div className="trip-load-list">{rows.map((assignment) => (
          <article className={`app-panel trip-load-card ${assignment.state.toLowerCase()}`} key={assignment.id}>
            <div className="trip-load-main">
              <div><span>{assignment.jobNumber} · คันที่ {assignment.sequenceNumber}</span><h3><Link href={`/app/motorcycles/${assignment.motorcycleId}`}>{[assignment.make, assignment.model, assignment.color].filter(Boolean).join(" · ") || "รถจักรยานยนต์"}</Link></h3><p>{assignment.companyName} · {assignment.registration || "ไม่มีทะเบียน"}</p></div>
              <div className="trip-load-status"><span className="status-pill">{assignmentLabels[assignment.state]}</span><small>รถ: {motorcycleStatusLabels[assignment.motorcycleStatus]}</small></div>
            </div>
            {assignment.releaseReason && <p className="trip-release-note">เหตุผลปิดรายการ: {assignment.releaseReason}</p>}
            {canManage && assignment.state !== "RELEASED" && (
              <div className="trip-load-actions">
                {assignment.state === "ASSIGNED" && trip.status === "LOADING" && ["LOADED", "IN_TRANSIT"].includes(assignment.motorcycleStatus) && <ActionForm tripId={id} assignmentId={assignment.id} action="MARK_LOADED" label="ยืนยันขึ้นรถแล้ว" />}
                {assignment.state === "LOADED" && trip.status === "ARRIVED" && ["ARRIVED", "DELIVERED", "CLOSED"].includes(assignment.motorcycleStatus) && <ActionForm tripId={id} assignmentId={assignment.id} action="MARK_UNLOADED" label="ยืนยันลงรถแล้ว" />}
                {assignment.state === "ASSIGNED" && assignableTrip && <form action={`/api/trips/${id}/assignments/${assignment.id}`} method="post"><input type="hidden" name="action" value="RELEASE" /><input name="reason" minLength={3} maxLength={500} placeholder="เหตุผลนำออกจากเที่ยว *" required /><button type="submit">นำออกจากเที่ยว</button></form>}
                {assignment.state === "ASSIGNED" && (trip.status !== "LOADING" || assignment.motorcycleStatus === "SCHEDULED") && <p>{trip.status !== "LOADING" ? "เลื่อนเที่ยวเป็นกำลังขึ้นรถก่อนยืนยันรายคัน" : "เปลี่ยนสถานะรถเป็น “ขึ้นรถแล้ว” ที่หน้ารถก่อนยืนยันรายการนี้"}</p>}
                {assignment.state === "LOADED" && (trip.status !== "ARRIVED" || !["ARRIVED", "DELIVERED", "CLOSED"].includes(assignment.motorcycleStatus)) && <p>เที่ยวและรถต้องถึงปลายทางก่อนยืนยันลงรถ</p>}
                {assignment.state === "UNLOADED" && <p>รายการพร้อมปิดอัตโนมัติเมื่อเที่ยวเสร็จสิ้น</p>}
              </div>
            )}
          </article>
        ))}</div> : <div className="app-panel app-empty"><div>📋</div><h2>{cursor ? "ไม่มีรายการในหน้าถัดไป" : "ยังไม่มีรถในเที่ยว"}</h2><p>จัดรถจริงเข้าเที่ยวก่อนเริ่มขั้นตอนขึ้นรถ</p></div>}
        <nav className="batch-navigation" aria-label="หน้ารายการรถในเที่ยว"><span>แสดงรายการตามลำดับจัดเข้าเที่ยว</span>{hasMore && next && <Link className="button button-glass button-small" href={`/app/trips/${id}?after=${encodeURIComponent(next.assignedAt)}&afterId=${encodeURIComponent(next.id)}${motorcycleSearch ? `&motorcycleQ=${encodeURIComponent(motorcycleSearch)}` : ""}`}>หน้าถัดไป</Link>}</nav>
      </section>

      {can(actor, "jobs:write") && nextStatuses.length > 0 && (
        <section className="detail-section">
          <div className="detail-section-head"><div><p>TRIP WORKFLOW</p><h2>เลื่อนสถานะเที่ยว</h2></div></div>
          <div className="trip-workflow-grid">{nextStatuses.map((newStatus) => {
            const issue = tripReadinessIssue(newStatus, readinessRows);
            return <form className="app-panel trip-workflow-form" action={`/api/trips/${id}/status`} method="post" key={newStatus}><input type="hidden" name="newStatus" value={newStatus} /><div><span>{tripStatusLabels[newStatus]}</span><p>{issue || "ข้อมูลรถและเที่ยวพร้อมสำหรับขั้นตอนนี้"}</p></div><input name="note" maxLength={1000} required={newStatus === "CANCELLED"} placeholder={newStatus === "CANCELLED" ? "เหตุผลที่ยกเลิก *" : "หมายเหตุ (ถ้ามี)"} /><button type="submit" disabled={Boolean(issue)}>{tripStatusLabels[newStatus]}</button></form>;
          })}</div>
        </section>
      )}

      <section className="detail-section">
        <div className="detail-section-head"><div><p>AUDITED TIMELINE</p><h2>ประวัติสถานะเที่ยว</h2></div><span>แสดงสูงสุด 100 เหตุการณ์</span></div>
        <ol className="timeline">{statusEvents.map((event) => <li key={event.id}><span className="timeline-dot" /><div><b>{tripStatusLabels[event.newStatus]}</b><p>{event.note || "ไม่มีหมายเหตุ"}</p><small>{formatThaiDateTime(event.createdAt)} · {event.actorName}</small></div></li>)}</ol>
      </section>
    </>
  );
}

function ActionForm({ tripId, assignmentId, action, label }: { tripId: string; assignmentId: string; action: string; label: string }) {
  return <form action={`/api/trips/${tripId}/assignments/${assignmentId}`} method="post"><input type="hidden" name="action" value={action} /><button type="submit">{label}</button></form>;
}

function Messages({ status, error }: { status?: string; error?: string }) {
  const success = status === "assignment_created" ? "จัดรถเข้าเที่ยวเรียบร้อยแล้ว" : status === "assignment_exists" ? "คำขอนี้จัดรถเข้าเที่ยวแล้ว ระบบไม่สร้างรายการซ้ำ" : status === "loaded" ? "ยืนยันรถขึ้นเที่ยวแล้ว" : status === "unloaded" ? "ยืนยันรถลงจากเที่ยวแล้ว" : status === "released" ? "นำรถออกจากเที่ยวและเก็บประวัติแล้ว" : status === "trip_updated" ? "อัปเดตสถานะเที่ยวและ Audit แล้ว" : null;
  return <>{success && <div className="form-message success page-message">{success}</div>}{error && <div className="form-message error page-message" role="alert">บันทึกไม่สำเร็จ ข้อมูลเที่ยว รถ ความจุ หรือสถานะอาจไม่สอดคล้อง กรุณาเปิดหน้ารถและตรวจสถานะจริงก่อนลองอีกครั้ง</div>}</>;
}

function parseCursor(assignedAt?: string, id?: string): { assignedAt: string; id: string } | undefined | null {
  if (!assignedAt && !id) return undefined;
  if (!assignedAt || !id || id.length > 100 || Number.isNaN(Date.parse(assignedAt))) return null;
  return { assignedAt, id };
}

function formatThaiDateTime(value: string | null): string {
  if (!value) return "ยังไม่กำหนด";
  const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "ข้อมูลเวลาไม่ถูกต้อง";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(date);
}
