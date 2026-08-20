import {
  and,
  asc,
  count,
  eq,
  gt,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import {
  companies,
  containerMotorcycleAssignments,
  containerStatusEvents,
  motorcycles,
  shippingContainers,
  transportJobs,
  tripMotorcycleAssignments,
  users,
  type ContainerAssignmentState,
  type ContainerStatus,
} from "@/db/schema";
import { can, isInternalRole } from "@/lib/authorization";
import {
  allowedContainerTransitions,
  containerReadinessIssue,
} from "@/lib/containers";
import { requireActor } from "@/lib/current-actor";
import { motorcycleStatusLabels } from "@/lib/labels";
import { normalizeLoadBoardSearch } from "@/lib/trips";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const containerStatusLabels: Record<ContainerStatus, string> = {
  DRAFT: "ร่าง",
  PLANNED: "วางแผนแล้ว",
  LOADING: "กำลังโหลดตู้",
  SEALED: "ปิด Seal แล้ว",
  IN_TRANSIT: "กำลังขนส่ง",
  ARRIVED: "ถึงปลายทาง",
  UNLOADING: "กำลังนำรถลง",
  COMPLETED: "เสร็จสิ้น",
  CANCELLED: "ยกเลิก",
};
const assignmentLabels: Record<ContainerAssignmentState, string> = {
  ASSIGNED: "จัดเข้าตู้แล้ว",
  LOADED: "ยืนยันขึ้นตู้แล้ว",
  UNLOADED: "ยืนยันลงจากตู้แล้ว",
  RELEASED: "ปิดรายการแล้ว",
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    status?: string;
    error?: string;
    after?: string;
    afterId?: string;
    motorcycleQ?: string;
  }>;
};

export default async function ContainerDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const actor = await requireActor(`/app/containers/${id}`);
  if (!isInternalRole(actor.role) || !can(actor, "jobs:read")) redirect("/app");
  const cursor = parseCursor(query.after, query.afterId);
  if (cursor === null) notFound();
  const motorcycleSearch = normalizeLoadBoardSearch(query.motorcycleQ ?? "");
  if (motorcycleSearch === undefined) notFound();

  const db = getDb();
  const container = await db
    .select()
    .from(shippingContainers)
    .where(eq(shippingContainers.id, id))
    .get();
  if (!container) notFound();

  const cursorFilter = cursor
    ? or(
        gt(containerMotorcycleAssignments.assignedAt, cursor.assignedAt),
        and(
          eq(containerMotorcycleAssignments.assignedAt, cursor.assignedAt),
          gt(containerMotorcycleAssignments.id, cursor.id),
        ),
      )
    : undefined;
  const canManage = can(actor, "jobs:write") && can(actor, "motorcycles:write");
  const [assignmentRows, readinessRows, statusEvents, totalRow] = await Promise.all([
    db
      .select({
        id: containerMotorcycleAssignments.id,
        motorcycleId: motorcycles.id,
        state: containerMotorcycleAssignments.state,
        assignedAt: containerMotorcycleAssignments.assignedAt,
        releaseReason: containerMotorcycleAssignments.releaseReason,
        motorcycleStatus: motorcycles.currentStatus,
        sequenceNumber: motorcycles.sequenceNumber,
        make: motorcycles.make,
        model: motorcycles.model,
        color: motorcycles.color,
        registration: motorcycles.registration,
        jobNumber: transportJobs.jobNumber,
        companyName: companies.displayName,
      })
      .from(containerMotorcycleAssignments)
      .innerJoin(motorcycles, eq(motorcycles.id, containerMotorcycleAssignments.motorcycleId))
      .innerJoin(transportJobs, eq(transportJobs.id, motorcycles.jobId))
      .innerJoin(companies, eq(companies.id, motorcycles.companyId))
      .where(and(eq(containerMotorcycleAssignments.containerId, id), cursorFilter))
      .orderBy(asc(containerMotorcycleAssignments.assignedAt), asc(containerMotorcycleAssignments.id))
      .limit(PAGE_SIZE + 1)
      .all(),
    db
      .select({ state: containerMotorcycleAssignments.state, motorcycleStatus: motorcycles.currentStatus })
      .from(containerMotorcycleAssignments)
      .innerJoin(motorcycles, eq(motorcycles.id, containerMotorcycleAssignments.motorcycleId))
      .where(and(
        eq(containerMotorcycleAssignments.containerId, id),
        isNull(containerMotorcycleAssignments.releasedAt),
      ))
      .limit(1000)
      .all(),
    db
      .select({
        id: containerStatusEvents.id,
        previousStatus: containerStatusEvents.previousStatus,
        newStatus: containerStatusEvents.newStatus,
        note: containerStatusEvents.note,
        createdAt: containerStatusEvents.createdAt,
        actorName: users.displayName,
      })
      .from(containerStatusEvents)
      .innerJoin(users, eq(users.id, containerStatusEvents.createdBy))
      .where(eq(containerStatusEvents.containerId, id))
      .orderBy(asc(containerStatusEvents.createdAt))
      .limit(100)
      .all(),
    db
      .select({ total: count() })
      .from(containerMotorcycleAssignments)
      .where(eq(containerMotorcycleAssignments.containerId, id))
      .get(),
  ]);

  const hasMore = assignmentRows.length > PAGE_SIZE;
  const rows = assignmentRows.slice(0, PAGE_SIZE);
  const next = rows.at(-1);
  const activeCount = readinessRows.length;
  const effectiveCapacity = container.capacityMotorcycles ?? 1000;
  const capacityAvailable = activeCount < effectiveCapacity;
  const assignableContainer = ["DRAFT", "PLANNED"].includes(container.status);

  const queryEligible = (searchFilter?: SQL) => db
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
      containerMotorcycleAssignments,
      and(
        eq(containerMotorcycleAssignments.motorcycleId, motorcycles.id),
        isNull(containerMotorcycleAssignments.releasedAt),
      ),
    )
    .leftJoin(
      tripMotorcycleAssignments,
      and(
        eq(tripMotorcycleAssignments.motorcycleId, motorcycles.id),
        isNull(tripMotorcycleAssignments.releasedAt),
      ),
    )
    .where(and(
      eq(motorcycles.currentStatus, "SCHEDULED"),
      isNull(containerMotorcycleAssignments.id),
      isNull(tripMotorcycleAssignments.id),
      searchFilter,
    ))
    .orderBy(asc(transportJobs.jobNumber), asc(motorcycles.sequenceNumber))
    .limit(101)
    .all();
  const eligibleRows = canManage && assignableContainer && capacityAvailable
    ? motorcycleSearch
      ? await Promise.all([
          queryEligible(sql`${transportJobs.jobNumber} GLOB ${`${motorcycleSearch.toUpperCase()}*`}`),
          queryEligible(sql`${motorcycles.publicId} GLOB ${`${motorcycleSearch.toLowerCase()}*`}`),
          queryEligible(and(
            isNotNull(motorcycles.registration),
            ne(motorcycles.registration, ""),
            sql`${motorcycles.registration} GLOB ${`${motorcycleSearch}*`}`,
          )),
        ]).then((groups) => {
          const uniqueRows = new Map(groups.flat().map((motorcycle) => [motorcycle.id, motorcycle]));
          return [...uniqueRows.values()]
            .sort((left, right) => left.jobNumber.localeCompare(right.jobNumber) || left.sequenceNumber - right.sequenceNumber)
            .slice(0, 101);
        })
      : await queryEligible()
    : [];
  const eligibleTruncated = eligibleRows.length > 100;
  const eligible = eligibleRows.slice(0, 100);
  const nextStatuses = allowedContainerTransitions(container.status);

  return (
    <>
      <div className="app-page-head">
        <div>
          <p>{container.containerNumber}</p>
          <h1>{container.type} · {container.port} → {container.country}</h1>
          <span>Seal {container.sealNumber || "ยังไม่ระบุ"} · สร้าง {formatThaiDateTime(container.createdAt)}</span>
        </div>
        <div className="app-page-actions">
          <Link href="/app/containers">← กลับทะเบียนตู้</Link>
          <span className={`status-pill ${container.status}`}>{containerStatusLabels[container.status]}</span>
        </div>
      </div>
      <Messages status={query.status} error={query.error} />

      <section className="trip-overview-grid">
        <article className="app-panel trip-capacity-card">
          <p>CONTAINER CAPACITY</p>
          <strong>{activeCount}<small> / {container.capacityMotorcycles ?? "สูงสุด 1,000*"} คัน</small></strong>
          <span>{capacityAvailable ? (container.capacityMotorcycles === null ? "ยังไม่ยืนยันความจุจริง · ระบบจำกัดสูงสุด 1,000" : "ยังเพิ่มรถเข้าตู้ได้") : "เต็มความจุที่กำหนด"}</span>
        </article>
        <article className="app-panel trip-time-card"><p>SEAL</p><strong>{container.sealNumber || "ยังไม่ระบุ"}</strong><span>แก้ได้ก่อนปิด Seal เท่านั้น</span></article>
        <article className="app-panel trip-time-card"><p>DESTINATION</p><strong>{container.country}</strong><span>ท่าเรือ {container.port}</span></article>
      </section>

      {canManage && assignableContainer && capacityAvailable && (
        <section className="detail-section">
          <div className="detail-section-head"><div><p>ASSIGN MOTORCYCLE</p><h2>จัดรถเข้าตู้</h2></div><span>เฉพาะรถ “รอขึ้นรถ” ที่ไม่อยู่เที่ยวหรือตู้อื่น</span></div>
          <form className="trip-load-search" action={`/app/containers/${id}`} method="get" role="search">
            <label htmlFor="motorcycleQ">ค้นหาด้วยเลข Job, Public ID หรือทะเบียน (ขึ้นต้นด้วย)</label>
            <div>
              <input id="motorcycleQ" name="motorcycleQ" minLength={2} maxLength={50} defaultValue={motorcycleSearch ?? ""} placeholder="เช่น JOB-2026 หรือ 1กข" />
              <button type="submit">ค้นหา</button>
              {motorcycleSearch && <Link href={`/app/containers/${id}`}>ล้างการค้นหา</Link>}
            </div>
          </form>
          {eligible.length ? (
            <form className="app-panel trip-assign-form" action={`/api/containers/${id}/assignments`} method="post">
              <input type="hidden" name="requestKey" value={crypto.randomUUID()} />
              <div className="field">
                <label htmlFor="motorcycleId">รถจักรยานยนต์</label>
                <select id="motorcycleId" name="motorcycleId" required>
                  <option value="">เลือกรถ</option>
                  {eligible.map((motorcycle) => <option key={motorcycle.id} value={motorcycle.id}>{motorcycle.jobNumber} · คันที่ {motorcycle.sequenceNumber} · {[motorcycle.make, motorcycle.model, motorcycle.registration].filter(Boolean).join(" / ") || "ยังไม่ระบุรายละเอียด"} · {motorcycle.companyName}</option>)}
                </select>
              </div>
              <button className="button button-gradient button-small" type="submit">จัดเข้าตู้</button>
              {eligibleTruncated && <p>พบมากกว่า 100 รายการ กรุณาค้นหาให้แคบลง</p>}
            </form>
          ) : <div className="app-panel app-empty"><div>🏍️</div><h2>{motorcycleSearch ? "ไม่พบรถตรงกับคำค้น" : "ไม่มีรถที่พร้อมจัดเข้าตู้"}</h2><p>{motorcycleSearch ? "ตรวจเลข Job, Public ID หรือทะเบียน แล้วค้นหาอีกครั้ง" : "รถต้องอยู่สถานะรอขึ้นรถและไม่ถูกจัดไว้ในเที่ยวหรือตู้อื่น"}</p></div>}
        </section>
      )}

      <section className="detail-section">
        <div className="detail-section-head"><div><p>CONTAINER LOAD MANIFEST</p><h2>รถจักรยานยนต์ในตู้</h2></div><span>{totalRow?.total ?? 0} รายการรวมประวัติ · หน้าละ {PAGE_SIZE}</span></div>
        {rows.length ? <div className="trip-load-list">{rows.map((assignment) => (
          <article className={`app-panel trip-load-card ${assignment.state.toLowerCase()}`} key={assignment.id}>
            <div className="trip-load-main">
              <div><span>{assignment.jobNumber} · คันที่ {assignment.sequenceNumber}</span><h3><Link href={`/app/motorcycles/${assignment.motorcycleId}`}>{[assignment.make, assignment.model, assignment.color].filter(Boolean).join(" · ") || "รถจักรยานยนต์"}</Link></h3><p>{assignment.companyName} · {assignment.registration || "ไม่มีทะเบียน"}</p></div>
              <div className="trip-load-status"><span className="status-pill">{assignmentLabels[assignment.state]}</span><small>รถ: {motorcycleStatusLabels[assignment.motorcycleStatus]}</small></div>
            </div>
            {assignment.releaseReason && <p className="trip-release-note">เหตุผลปิดรายการ: {assignment.releaseReason}</p>}
            {canManage && assignment.state !== "RELEASED" && (
              <div className="trip-load-actions">
                {assignment.state === "ASSIGNED" && container.status === "LOADING" && assignment.motorcycleStatus === "LOADED" && <ActionForm containerId={id} assignmentId={assignment.id} action="MARK_LOADED" label="ยืนยันขึ้นตู้แล้ว" />}
                {assignment.state === "LOADED" && container.status === "UNLOADING" && ["ARRIVED", "DELIVERED", "CLOSED"].includes(assignment.motorcycleStatus) && <ActionForm containerId={id} assignmentId={assignment.id} action="MARK_UNLOADED" label="ยืนยันลงจากตู้แล้ว" />}
                {assignment.state === "ASSIGNED" && assignableContainer && <form action={`/api/containers/${id}/assignments/${assignment.id}`} method="post"><input type="hidden" name="action" value="RELEASE" /><input name="reason" minLength={3} maxLength={500} placeholder="เหตุผลนำออกจากตู้ *" required /><button type="submit">นำออกจากตู้</button></form>}
                {assignment.state === "ASSIGNED" && (container.status !== "LOADING" || assignment.motorcycleStatus !== "LOADED") && <p>{container.status !== "LOADING" ? "เลื่อนตู้เป็นกำลังโหลดก่อนยืนยันรายคัน" : "เปลี่ยนสถานะรถเป็นขึ้นรถแล้วที่หน้ารถก่อนยืนยันรายการนี้"}</p>}
                {assignment.state === "LOADED" && (container.status !== "UNLOADING" || !["ARRIVED", "DELIVERED", "CLOSED"].includes(assignment.motorcycleStatus)) && <p>ตู้และรถต้องถึงปลายทางและเริ่มนำรถลงก่อนยืนยัน</p>}
                {assignment.state === "UNLOADED" && <p>รายการพร้อมปิดอัตโนมัติเมื่อตู้เสร็จสิ้น</p>}
              </div>
            )}
          </article>
        ))}</div> : <div className="app-panel app-empty"><div>📋</div><h2>{cursor ? "ไม่มีรายการในหน้าถัดไป" : "ยังไม่มีรถในตู้"}</h2><p>จัดรถจริงเข้าตู้ก่อนเริ่มขั้นตอนโหลด</p></div>}
        <nav className="batch-navigation" aria-label="หน้ารายการรถในตู้"><span>แสดงตามลำดับจัดเข้าตู้</span>{hasMore && next && <Link className="button button-glass button-small" href={`/app/containers/${id}?after=${encodeURIComponent(next.assignedAt)}&afterId=${encodeURIComponent(next.id)}${motorcycleSearch ? `&motorcycleQ=${encodeURIComponent(motorcycleSearch)}` : ""}`}>หน้าถัดไป</Link>}</nav>
      </section>

      {can(actor, "jobs:write") && nextStatuses.length > 0 && (
        <section className="detail-section">
          <div className="detail-section-head"><div><p>CONTAINER WORKFLOW</p><h2>เลื่อนสถานะตู้</h2></div></div>
          <div className="trip-workflow-grid">{nextStatuses.map((newStatus) => {
            const issue = containerReadinessIssue(
              newStatus,
              readinessRows,
              newStatus === "SEALED" ? container.sealNumber ?? "PENDING_INPUT" : container.sealNumber,
            );
            return <form className="app-panel trip-workflow-form" action={`/api/containers/${id}/status`} method="post" key={newStatus}>
              <input type="hidden" name="newStatus" value={newStatus} />
              <div><span>{containerStatusLabels[newStatus]}</span><p>{issue || (newStatus === "SEALED" && !container.sealNumber ? "กรอกเลข Seal จริงเพื่อปิดตู้" : "ข้อมูลรถ ตู้ และ Seal พร้อมสำหรับขั้นตอนนี้")}</p></div>
              {newStatus === "SEALED" ? <input name="sealNumber" minLength={2} maxLength={50} defaultValue={container.sealNumber ?? ""} required placeholder="เลข Seal จริง *" /> : <input name="note" maxLength={1000} required={newStatus === "CANCELLED"} placeholder={newStatus === "CANCELLED" ? "เหตุผลที่ยกเลิก *" : "หมายเหตุ (ถ้ามี)"} />}
              <button type="submit" disabled={Boolean(issue)}>{containerStatusLabels[newStatus]}</button>
            </form>;
          })}</div>
        </section>
      )}

      <section className="detail-section">
        <div className="detail-section-head"><div><p>AUDITED TIMELINE</p><h2>ประวัติสถานะตู้</h2></div><span>แสดงสูงสุด 100 เหตุการณ์</span></div>
        <ol className="timeline">{statusEvents.map((event) => <li key={event.id}><span className="timeline-dot" /><div><b>{containerStatusLabels[event.newStatus]}</b><p>{event.note || "ไม่มีหมายเหตุ"}</p><small>{formatThaiDateTime(event.createdAt)} · {event.actorName}</small></div></li>)}</ol>
      </section>
    </>
  );
}

function ActionForm({ containerId, assignmentId, action, label }: { containerId: string; assignmentId: string; action: string; label: string }) {
  return <form action={`/api/containers/${containerId}/assignments/${assignmentId}`} method="post"><input type="hidden" name="action" value={action} /><button type="submit">{label}</button></form>;
}

function Messages({ status, error }: { status?: string; error?: string }) {
  const success = status === "assignment_created" ? "จัดรถเข้าตู้เรียบร้อยแล้ว" : status === "assignment_exists" ? "คำขอนี้จัดรถเข้าตู้แล้ว ระบบไม่สร้างรายการซ้ำ" : status === "loaded" ? "ยืนยันรถขึ้นตู้แล้ว" : status === "unloaded" ? "ยืนยันรถลงจากตู้แล้ว" : status === "released" ? "นำรถออกจากตู้และเก็บประวัติแล้ว" : status === "container_updated" ? "อัปเดตสถานะตู้และ Audit แล้ว" : null;
  return <>{success && <div className="form-message success page-message">{success}</div>}{error && <div className="form-message error page-message" role="alert">บันทึกไม่สำเร็จ ข้อมูลตู้ รถ Seal ความจุ หรือสถานะอาจไม่สอดคล้อง กรุณาตรวจข้อมูลจริงก่อนลองอีกครั้ง</div>}</>;
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
