import { and, asc, desc, eq, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { trips, trucks, userRoleAssignments, users, TRIP_STATUSES, TRUCK_TYPES, type TripStatus } from "@/db/schema";
import { can, isInternalRole } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { DIRECTORY_PAGE_SIZE, normalizeDirectorySearch } from "@/lib/directory-search";
import { normalizeLoadBoardSearch, TRIP_PAGE_SIZE } from "@/lib/trips";

export const dynamic = "force-dynamic";

const truckTypeLabels = {
  FOUR_WHEEL: "รถขนส่ง 4 ล้อ",
  SIX_WHEEL: "รถขนส่ง 6 ล้อ",
  OTHER: "ประเภทอื่น",
} as const;
const tripStatusLabels = {
  DRAFT: "ร่าง",
  PLANNED: "วางแผนแล้ว",
  LOADING: "กำลังขึ้นรถ",
  IN_TRANSIT: "กำลังขนส่ง",
  ARRIVED: "ถึงปลายทาง",
  COMPLETED: "เสร็จสิ้น",
  CANCELLED: "ยกเลิก",
} as const;

type Props = { searchParams: Promise<{ status?: string; error?: string; before?: string; beforeId?: string; tripStatus?: string; truckQ?: string; driverQ?: string }> };

export default async function TripsPage({ searchParams }: Props) {
  const actor = await requireActor("/app/trips");
  if (!isInternalRole(actor.role) || !can(actor, "jobs:read")) redirect("/app");
  const params = await searchParams;
  const cursor = parseCursor(params.before, params.beforeId);
  if (cursor === null) notFound();
  const truckSearch = normalizeLoadBoardSearch(params.truckQ ?? "");
  if (truckSearch === undefined) notFound();
  const driverSearch = normalizeDirectorySearch(params.driverQ ?? "");
  if (driverSearch === undefined) notFound();
  const selectedTripStatus = params.tripStatus ?? "";
  if (selectedTripStatus && !TRIP_STATUSES.includes(selectedTripStatus as TripStatus)) notFound();
  const db = getDb();
  const cursorFilter = cursor
    ? or(lt(trips.createdAt, cursor.createdAt), and(eq(trips.createdAt, cursor.createdAt), lt(trips.id, cursor.id)))
    : undefined;
  const tripStatusFilter = selectedTripStatus ? eq(trips.status, selectedTripStatus as TripStatus) : undefined;
  const truckRowsPromise = truckSearch
    ? Promise.all([
        db.select().from(trucks).where(sql`${trucks.code} GLOB ${`${truckSearch.toUpperCase()}*`}`).orderBy(asc(trucks.code)).limit(101).all(),
        db.select().from(trucks).where(and(isNotNull(trucks.registration), ne(trucks.registration, ""), sql`${trucks.registration} GLOB ${`${truckSearch}*`}`)).orderBy(asc(trucks.registration)).limit(101).all(),
      ]).then(([codeRows, registrationRows]) => {
        const uniqueRows = new Map([...codeRows, ...registrationRows].map((truck) => [truck.id, truck]));
        return [...uniqueRows.values()].sort((left, right) => left.code.localeCompare(right.code)).slice(0, 101);
      })
    : db.select().from(trucks).orderBy(asc(trucks.code)).limit(101).all();
  const driverRowsPromise = driverSearch
    ? Promise.all([
        db.select({ id: users.id, displayName: users.displayName, email: users.email }).from(users)
          .innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
          .where(and(eq(users.status, "ACTIVE"), eq(userRoleAssignments.role, "DRIVER"), sql`${users.displayName} GLOB ${`${driverSearch}*`}`))
          .orderBy(asc(users.displayName), asc(users.id)).limit(DIRECTORY_PAGE_SIZE + 1).all(),
        db.select({ id: users.id, displayName: users.displayName, email: users.email }).from(users)
          .innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
          .where(and(eq(users.status, "ACTIVE"), eq(userRoleAssignments.role, "DRIVER"), sql`${users.email} GLOB ${`${driverSearch.toLowerCase()}*`}`))
          .orderBy(asc(users.email), asc(users.id)).limit(DIRECTORY_PAGE_SIZE + 1).all(),
      ]).then(([nameRows, emailRows]) => mergeDriverRows(nameRows, emailRows))
    : Promise.resolve([]);
  const [tripRows, truckRows, driverRows] = await Promise.all([
    db.select({
      id: trips.id,
      tripNumber: trips.tripNumber,
      truckCode: trucks.code,
      truckRegistration: trucks.registration,
      driverName: users.displayName,
      origin: trips.origin,
      destination: trips.destination,
      plannedDepartureAt: trips.plannedDepartureAt,
      plannedArrivalAt: trips.plannedArrivalAt,
      actualDepartureAt: trips.actualDepartureAt,
      actualArrivalAt: trips.actualArrivalAt,
      status: trips.status,
      createdAt: trips.createdAt,
    })
      .from(trips)
      .innerJoin(trucks, eq(trucks.id, trips.truckId))
      .leftJoin(users, eq(users.id, trips.driverUserId))
      .where(and(cursorFilter, tripStatusFilter))
      .orderBy(desc(trips.createdAt), desc(trips.id))
      .limit(TRIP_PAGE_SIZE + 1)
      .all(),
    truckRowsPromise,
    driverRowsPromise,
  ]);
  const hasMore = tripRows.length > TRIP_PAGE_SIZE;
  const rows = tripRows.slice(0, TRIP_PAGE_SIZE);
  const next = rows.at(-1);
  const trucksTruncated = truckRows.length > 100;
  const visibleTrucks = truckRows.slice(0, 100);
  const activeTrucks = visibleTrucks.filter((truck) => truck.status === "ACTIVE");
  const driversTruncated = driverRows.length > DIRECTORY_PAGE_SIZE;
  const visibleDrivers = driverRows.slice(0, DIRECTORY_PAGE_SIZE);
  const canWrite = can(actor, "jobs:write");
  const truckRequestKey = crypto.randomUUID();
  const tripRequestKey = crypto.randomUUID();

  return (
    <>
      <div className="app-page-head"><div><p>TRIP OPERATIONS</p><h1>เที่ยววิ่งและรถขนส่ง</h1><span>วางแผนรถ คนขับ เวลา และสถานะเที่ยวจากข้อมูลจริง</span></div></div>
      {params.status === "truck_created" && <div className="form-message success page-message">เพิ่มรถขนส่งเรียบร้อยแล้ว</div>}
      {params.status === "truck_exists" && <div className="login-notice page-message">คำขอนี้บันทึกรถขนส่งแล้ว ระบบไม่สร้างข้อมูลซ้ำ</div>}
      {params.status === "trip_created" && <div className="form-message success page-message">สร้างเที่ยววิ่งในสถานะร่างแล้ว</div>}
      {params.status === "trip_exists" && <div className="login-notice page-message">คำขอนี้สร้างเที่ยวแล้ว ระบบไม่สร้างเที่ยวซ้ำ</div>}
      {params.status === "trip_updated" && <div className="form-message success page-message">อัปเดตสถานะเที่ยวและบันทึก Audit แล้ว</div>}
      {params.error && <div className="form-message error page-message" role="alert">บันทึกไม่สำเร็จ กรุณาตรวจข้อมูล รถ คนขับ ลำดับสถานะ หรือข้อมูลที่ถูกแก้จากอีกหน้าจอ</div>}

      <section className="trip-discovery-tools">
        <form className="trip-load-search" action="/app/trips" method="get" role="search">
          {selectedTripStatus && <input type="hidden" name="tripStatus" value={selectedTripStatus} />}
          {driverSearch && <input type="hidden" name="driverQ" value={driverSearch} />}
          <label htmlFor="truckQ">ค้นหารถขนส่งด้วยรหัสรถหรือทะเบียน (ขึ้นต้นด้วย)</label>
          <div><input id="truckQ" name="truckQ" minLength={2} maxLength={50} defaultValue={truckSearch ?? ""} placeholder="เช่น NG-01 หรือ 1กข" /><button type="submit">ค้นหารถ</button>{truckSearch && <Link href={`/app/trips${selectedTripStatus ? `?tripStatus=${selectedTripStatus}` : ""}`}>ล้าง</Link>}</div>
        </form>
        <form className="trip-load-search directory-search" action="/app/trips" method="get" role="search">
          {selectedTripStatus && <input type="hidden" name="tripStatus" value={selectedTripStatus} />}
          {truckSearch && <input type="hidden" name="truckQ" value={truckSearch} />}
          <label htmlFor="driverQ">ค้นหาคนขับด้วยชื่อหรืออีเมล (ขึ้นต้นด้วย)</label>
          <div><input id="driverQ" name="driverQ" minLength={2} maxLength={80} defaultValue={driverSearch ?? ""} placeholder="เช่น สมชาย หรือ driver@" /><button type="submit">ค้นหาคนขับ</button>{driverSearch && <Link href={`/app/trips${selectedTripStatus || truckSearch ? `?${[selectedTripStatus ? `tripStatus=${selectedTripStatus}` : "", truckSearch ? `truckQ=${encodeURIComponent(truckSearch)}` : ""].filter(Boolean).join("&")}` : ""}`}>ล้าง</Link>}</div>
        </form>
        <nav className="trip-status-filters" aria-label="กรองสถานะเที่ยว"><Link className={!selectedTripStatus ? "active" : ""} href={`/app/trips?${[truckSearch ? `truckQ=${encodeURIComponent(truckSearch)}` : "", driverSearch ? `driverQ=${encodeURIComponent(driverSearch)}` : ""].filter(Boolean).join("&")}`}>ทั้งหมด</Link>{TRIP_STATUSES.map((status) => <Link className={selectedTripStatus === status ? "active" : ""} href={`/app/trips?tripStatus=${status}${truckSearch ? `&truckQ=${encodeURIComponent(truckSearch)}` : ""}${driverSearch ? `&driverQ=${encodeURIComponent(driverSearch)}` : ""}`} key={status}>{tripStatusLabels[status]}</Link>)}</nav>
      </section>

      {canWrite && <section className="trip-create-grid">
        <form className="record-form" action="/api/trucks" method="post">
          <input type="hidden" name="requestKey" value={truckRequestKey} />
          <div className="full detail-section-head"><div><p>TRUCK</p><h2>เพิ่มรถขนส่ง</h2></div></div>
          <div className="field"><label htmlFor="truckCode">รหัสรถ *</label><input id="truckCode" name="code" maxLength={30} placeholder="NG-01" required /></div>
          <div className="field"><label htmlFor="registration">ทะเบียน</label><input id="registration" name="registration" maxLength={30} /></div>
          <div className="field"><label htmlFor="truckType">ประเภทรถ *</label><select id="truckType" name="type" required>{TRUCK_TYPES.map((type) => <option key={type} value={type}>{truckTypeLabels[type]}</option>)}</select></div>
          <div className="field"><label htmlFor="capacityMotorcycles">ความจุที่ยืนยันแล้ว (คัน)</label><input id="capacityMotorcycles" name="capacityMotorcycles" type="number" min={1} max={1000} inputMode="numeric" /></div>
          <div className="field full"><label htmlFor="truckNotes">หมายเหตุ</label><input id="truckNotes" name="notes" maxLength={1000} /></div>
          <div className="full"><button className="button button-gradient button-small" type="submit">บันทึกรถขนส่ง</button></div>
        </form>

        {activeTrucks.length ? <form className="record-form" action="/api/trips" method="post">
          <input type="hidden" name="requestKey" value={tripRequestKey} />
          <div className="full detail-section-head"><div><p>TRIP</p><h2>สร้างเที่ยววิ่ง</h2></div></div>
          <div className="field"><label htmlFor="tripTruck">รถขนส่ง *</label><select id="tripTruck" name="truckId" required><option value="">เลือกรถ</option>{activeTrucks.map((truck) => <option key={truck.id} value={truck.id}>{truck.code} · {truck.registration || "ยังไม่มีทะเบียน"}</option>)}</select></div>
          <div className="field"><label htmlFor="tripDriver">คนขับ</label><select id="tripDriver" name="driverUserId"><option value="">{driverSearch ? "ยังไม่กำหนด" : "ค้นหาคนขับก่อน หรือยังไม่กำหนด"}</option>{visibleDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.displayName} · {driver.email}</option>)}</select></div>
          <div className="field"><label htmlFor="tripOrigin">ต้นทาง *</label><input id="tripOrigin" name="origin" maxLength={200} required /></div>
          <div className="field"><label htmlFor="tripDestination">ปลายทาง *</label><input id="tripDestination" name="destination" maxLength={200} required /></div>
          <div className="field"><label htmlFor="plannedDepartureAt">ออกเดินทาง (เวลาไทย)</label><input id="plannedDepartureAt" name="plannedDepartureAt" type="datetime-local" /></div>
          <div className="field"><label htmlFor="plannedArrivalAt">ถึงโดยประมาณ (เวลาไทย)</label><input id="plannedArrivalAt" name="plannedArrivalAt" type="datetime-local" /></div>
          <div className="field full"><label htmlFor="tripNotes">หมายเหตุ</label><input id="tripNotes" name="notes" maxLength={1000} /></div>
          <div className="full"><button className="button button-gradient button-small" type="submit">สร้างเที่ยวสถานะร่าง</button></div>
        </form> : <div className="app-panel app-empty"><div>🚚</div><h2>เพิ่มรถขนส่งก่อน</h2><p>ระบบจะไม่สร้างเที่ยวที่ไม่มีรถจริง</p></div>}
      </section>}
      {driversTruncated && <div className="login-notice page-message">พบมากกว่า {DIRECTORY_PAGE_SIZE} คนขับ กรุณาระบุชื่อหรืออีเมลให้เจาะจงขึ้น</div>}
      {driverSearch && !visibleDrivers.length && <div className="login-notice page-message">ไม่พบพนักงานขับรถที่ Active ตรงกับคำค้น</div>}

      <section className="detail-section"><div className="detail-section-head"><div><p>FLEET</p><h2>รถขนส่ง</h2></div><span>สูงสุด 200 คันในหน้าจัดการ</span></div>
        <div className="truck-grid">{visibleTrucks.map((truck) => <article className="app-panel truck-card" key={truck.id}><div><b>{truck.code}</b><span className="status-pill">{truck.status}</span></div><h3>{truckTypeLabels[truck.type]}</h3><p>{truck.registration || "ยังไม่มีทะเบียน"}</p><small>ความจุ {truck.capacityMotorcycles ?? "ยังไม่ยืนยัน"} คัน</small></article>)}{!visibleTrucks.length && <div className="app-panel app-empty"><div>🚚</div><h2>{truckSearch ? "ไม่พบรถตรงกับคำค้น" : "ยังไม่มีรถขนส่ง"}</h2><p>{truckSearch ? "ตรวจรหัสรถหรือทะเบียนแล้วค้นหาอีกครั้ง" : "บันทึกรถจริงก่อนเริ่มวางเที่ยว"}</p></div>}</div>
        {trucksTruncated && <div className="login-notice page-message">พบรถมากกว่า 100 รายการ กรุณาค้นหาด้วยรหัสรถหรือทะเบียนเพื่อเลือกคันที่ต้องการ</div>}
      </section>

      <section className="detail-section"><div className="detail-section-head"><div><p>TRIPS</p><h2>เที่ยวล่าสุด</h2></div><span>{rows.length} รายการในหน้านี้</span></div>
        {rows.length ? <div className="trip-list">{rows.map((trip) => <article className="app-panel trip-card" key={trip.id}>
          <div className="trip-card-head"><div><span>{trip.tripNumber}</span><h3><Link href={`/app/trips/${trip.id}`}>{trip.origin} → {trip.destination}</Link></h3></div><span className={`status-pill ${trip.status}`}>{tripStatusLabels[trip.status]}</span></div>
          <dl><div><dt>รถ</dt><dd>{trip.truckCode}<small>{trip.truckRegistration || "ไม่มีทะเบียน"}</small></dd></div><div><dt>คนขับ</dt><dd>{trip.driverName || "ยังไม่กำหนด"}</dd></div><div><dt>กำหนดออก</dt><dd>{formatThaiDateTime(trip.plannedDepartureAt)}</dd></div><div><dt>กำหนดถึง</dt><dd>{formatThaiDateTime(trip.plannedArrivalAt)}</dd></div></dl>
          <Link className="trip-detail-link" href={`/app/trips/${trip.id}`}>เปิด Load Board และ Timeline →</Link>
        </article>)}</div> : <div className="app-panel app-empty"><div>🛣️</div><h2>ยังไม่มีเที่ยววิ่ง</h2><p>สร้างเที่ยวจากรถขนส่งจริง ระบบจะไม่แสดงรายการตัวอย่าง</p></div>}
        <nav className="batch-navigation" aria-label="หน้าเที่ยววิ่ง"><span>แสดงสูงสุด {TRIP_PAGE_SIZE} เที่ยวต่อหน้า</span>{hasMore && next && <Link className="button button-glass button-small" href={`/app/trips?before=${encodeURIComponent(next.createdAt)}&beforeId=${encodeURIComponent(next.id)}${selectedTripStatus ? `&tripStatus=${selectedTripStatus}` : ""}${truckSearch ? `&truckQ=${encodeURIComponent(truckSearch)}` : ""}${driverSearch ? `&driverQ=${encodeURIComponent(driverSearch)}` : ""}`}>หน้าถัดไป</Link>}</nav>
      </section>
    </>
  );
}

type DriverOption = { id: string; displayName: string; email: string };

function mergeDriverRows(...groups: DriverOption[][]): DriverOption[] {
  const unique = new Map(groups.flat().map((driver) => [driver.id, driver]));
  return [...unique.values()].sort((left, right) => left.displayName.localeCompare(right.displayName)).slice(0, DIRECTORY_PAGE_SIZE + 1);
}

function parseCursor(createdAt?: string, id?: string): { createdAt: string; id: string } | undefined | null {
  if (!createdAt && !id) return undefined;
  if (!createdAt || !id || id.length > 100 || Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
}

function formatThaiDateTime(value: string | null): string {
  if (!value) return "ยังไม่กำหนด";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ข้อมูลเวลาไม่ถูกต้อง";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(date);
}
