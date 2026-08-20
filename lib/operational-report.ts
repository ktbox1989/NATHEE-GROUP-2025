import { count, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/index.ts";
import {
  motorcycles,
  shippingContainers,
  transportJobs,
  trips,
  yardPlacements,
  yardZones,
} from "../db/schema.ts";
import { can, isCustomerRole, isInternalRole } from "./authorization.ts";
import type { CurrentActor } from "./current-actor.ts";
import { motorcycleStatusLabels } from "./labels.ts";
import { reportSection, type ReportSection } from "./report-metrics.ts";

export type { ReportSection, StatusMetric } from "./report-metrics.ts";

const jobLabels: Record<string, string> = { DRAFT: "ร่าง", OPEN: "เปิดงาน", IN_PROGRESS: "กำลังดำเนินงาน", COMPLETED: "เสร็จสิ้น", CANCELLED: "ยกเลิก" };
const tripLabels: Record<string, string> = { DRAFT: "ร่าง", PLANNED: "วางแผนแล้ว", LOADING: "กำลังขึ้นรถ", IN_TRANSIT: "กำลังขนส่ง", ARRIVED: "ถึงปลายทาง", COMPLETED: "เสร็จสิ้น", CANCELLED: "ยกเลิก" };
const containerLabels: Record<string, string> = { DRAFT: "ร่าง", PLANNED: "วางแผนแล้ว", LOADING: "กำลังโหลด", SEALED: "ปิด Seal", IN_TRANSIT: "กำลังขนส่ง", ARRIVED: "ถึงปลายทาง", UNLOADING: "กำลังนำรถลง", COMPLETED: "เสร็จสิ้น", CANCELLED: "ยกเลิก" };

export async function getOperationalReport(actor: CurrentActor): Promise<ReportSection[]> {
  const db = getDb();
  const customer = isCustomerRole(actor.role);
  const companyId = customer ? actor.companyId : null;
  const policyCompany = companyId ?? undefined;
  const sections: ReportSection[] = [];

  if (can(actor, "jobs:read", policyCompany)) {
    const rows = await db.select({ status: transportJobs.status, value: count() }).from(transportJobs).where(companyId ? eq(transportJobs.companyId, companyId) : undefined).groupBy(transportJobs.status).all();
    sections.push(reportSection("jobs", "งานขนส่งตามสถานะ", rows, jobLabels));
  }
  if (can(actor, "motorcycles:read", policyCompany)) {
    const rows = await db.select({ status: motorcycles.currentStatus, value: count() }).from(motorcycles).where(companyId ? eq(motorcycles.companyId, companyId) : undefined).groupBy(motorcycles.currentStatus).all();
    sections.push(reportSection("motorcycles", "รถจักรยานยนต์ตามสถานะ", rows, motorcycleStatusLabels));
  }
  if (isInternalRole(actor.role) && can(actor, "jobs:read")) {
    const [tripRows, containerRows] = await Promise.all([
      db.select({ status: trips.status, value: count() }).from(trips).groupBy(trips.status).all(),
      db.select({ status: shippingContainers.status, value: count() }).from(shippingContainers).groupBy(shippingContainers.status).all(),
    ]);
    sections.push(reportSection("trips", "เที่ยวขนส่งตามสถานะ", tripRows, tripLabels));
    sections.push(reportSection("containers", "Container ตามสถานะ", containerRows, containerLabels));
  }
  if (isInternalRole(actor.role) && can(actor, "yard:read")) {
    const [zones, placements] = await Promise.all([
      db.select({ value: count() }).from(yardZones).get(),
      db.select({ value: count() }).from(yardPlacements).where(isNull(yardPlacements.exitedAt)).get(),
    ]);
    sections.push({ key: "yard", title: "ลานจอดปัจจุบัน", total: Number(placements?.value ?? 0), metrics: [
      { status: "ACTIVE_PLACEMENTS", label: "รถที่อยู่ในลาน", count: Number(placements?.value ?? 0) },
      { status: "ZONES", label: "โซนทั้งหมด", count: Number(zones?.value ?? 0) },
    ] });
  }
  return sections;
}
