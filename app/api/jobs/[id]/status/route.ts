import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getD1, getDb } from "@/db";
import { motorcycles, transportJobs } from "@/db/schema";
import { adminReturnTarget } from "@/lib/admin-return";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import {
  canTransitionJob,
  jobCompletionIssue,
  parseJobStatus,
} from "@/lib/job-status";
import { isSameOrigin } from "@/lib/same-origin";
import { recordTimestamp } from "@/lib/timestamps";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);

  const { id } = await context.params;
  const db = getDb();
  const job = await db
    .select({ id: transportJobs.id, companyId: transportJobs.companyId, status: transportJobs.status, updatedAt: transportJobs.updatedAt })
    .from(transportJobs)
    .where(eq(transportJobs.id, id))
    .get();
  if (!job || !can(actor, "jobs:write", job.companyId)) {
    return redirect(request, `/app/jobs/${encodeURIComponent(id)}`, "error", "forbidden");
  }

  const form = await request.formData();
  const fallback = adminReturnTarget(form, `/app/jobs/${encodeURIComponent(id)}`);
  const expectedUpdatedAt = String(form.get("expectedUpdatedAt") ?? "");
  const newStatus = parseJobStatus(String(form.get("newStatus") ?? ""));
  const note = String(form.get("note") ?? "").trim().slice(0, 1000) || null;

  if (!expectedUpdatedAt || expectedUpdatedAt !== job.updatedAt) {
    return redirect(request, fallback, "error", "stale");
  }
  if (!newStatus || !canTransitionJob(job.status, newStatus)) {
    return redirect(request, fallback, "error", "invalid_transition");
  }
  if (newStatus === "CANCELLED" && (!note || note.length < 3)) {
    return redirect(request, fallback, "error", "cancel_reason");
  }

  if (newStatus === "COMPLETED") {
    const statuses = await db
      .select({ status: motorcycles.currentStatus })
      .from(motorcycles)
      .where(eq(motorcycles.jobId, id))
      .all();
    const issue = jobCompletionIssue(statuses.map((row) => row.status));
    if (issue) return redirect(request, fallback, "error", issue);
  }

  const recordedAt = recordTimestamp();
  const auditId = crypto.randomUUID();
  const beforeJson = JSON.stringify({ status: job.status });
  const afterJson = JSON.stringify({ status: newStatus });

  try {
    const d1 = getD1();
    const completionGate = newStatus === "COMPLETED" ? 1 : 0;
    const results = await d1.batch([
      d1.prepare(`
        INSERT INTO audit_logs
          (id, actor_user_id, company_id, action, entity_type, entity_id,
           before_json, after_json, reason, created_at)
        SELECT ?, ?, company_id, 'STATUS_CHANGE', 'transport_job', ?, ?, ?, ?, ?
        FROM transport_jobs
        WHERE id = ? AND status = ? AND updated_at = ?
          AND (
            ? = 0
            OR (
              EXISTS (SELECT 1 FROM motorcycles WHERE job_id = transport_jobs.id)
              AND NOT EXISTS (
                SELECT 1 FROM motorcycles
                WHERE job_id = transport_jobs.id
                  AND current_status NOT IN ('DELIVERED', 'CLOSED', 'CANCELLED')
              )
            )
          )
      `).bind(
        auditId,
        actor.userId,
        id,
        beforeJson,
        afterJson,
        note,
        recordedAt,
        id,
        job.status,
        expectedUpdatedAt,
        completionGate,
      ),
      d1.prepare(`
        UPDATE transport_jobs
        SET status = ?, updated_at = ?
        WHERE id = ? AND status = ?
          AND EXISTS (SELECT 1 FROM audit_logs WHERE id = ?)
      `).bind(newStatus, recordedAt, id, job.status, auditId),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1 || (results[1].meta.changes ?? 0) !== 1) {
      return redirect(request, fallback, "error", "stale");
    }
  } catch {
    return redirect(request, fallback, "error", "save_status");
  }

  return redirect(request, fallback, "status", "status_updated");
}

function redirect(
  request: NextRequest,
  base: string,
  key: "status" | "error",
  value: string,
) {
  return NextResponse.redirect(
    new URL(`${base}?${key}=${encodeURIComponent(value)}`, request.url),
    303,
  );
}
