import { count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { motorcycles, transportJobs } from "@/db/schema";
import { can, isCustomerRole } from "@/lib/authorization";
import type { CurrentActor } from "@/lib/current-actor";

export type DashboardMetrics = {
  jobs: number;
  motorcycles: number;
  inYard: number;
  inTransit: number;
  delivered: number;
  issues: number;
};

export async function getDashboardMetrics(
  actor: CurrentActor,
): Promise<DashboardMetrics> {
  const metrics: DashboardMetrics = {
    jobs: 0,
    motorcycles: 0,
    inYard: 0,
    inTransit: 0,
    delivered: 0,
    issues: 0,
  };
  const scopeCompanyId = isCustomerRole(actor.role) ? actor.companyId : null;
  const companyForPolicy = scopeCompanyId ?? undefined;
  const db = getDb();

  if (can(actor, "jobs:read", companyForPolicy)) {
    const jobScope = scopeCompanyId
      ? eq(transportJobs.companyId, scopeCompanyId)
      : undefined;
    const row = await db
      .select({ value: count() })
      .from(transportJobs)
      .where(jobScope)
      .get();
    metrics.jobs = row?.value ?? 0;
  }

  if (can(actor, "motorcycles:read", companyForPolicy)) {
    const motorcycleScope = scopeCompanyId
      ? eq(motorcycles.companyId, scopeCompanyId)
      : undefined;
    const rows = await db
      .select({ status: motorcycles.currentStatus, value: count() })
      .from(motorcycles)
      .where(motorcycleScope)
      .groupBy(motorcycles.currentStatus)
      .all();

    for (const row of rows) {
      metrics.motorcycles += row.value;
      if (row.status === "IN_YARD") metrics.inYard += row.value;
      if (row.status === "IN_TRANSIT") metrics.inTransit += row.value;
      if (inArrayValue(row.status, ["DELIVERED", "CLOSED"])) {
        metrics.delivered += row.value;
      }
      if (inArrayValue(row.status, ["ISSUE", "DAMAGED", "WAITING_DOCUMENTS"])) {
        metrics.issues += row.value;
      }
    }
  }

  return metrics;
}

function inArrayValue<T>(value: T, values: readonly T[]): boolean {
  return values.includes(value);
}
