import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, QUOTE_STATUSES, quoteRequests } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { recordTimestamp } from "@/lib/timestamps";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor || actor.role !== "OWNER") return new NextResponse("Forbidden", { status: 403 });
  const { id } = await params;
  const form = await request.formData();
  const status = String(form.get("status") ?? "") as (typeof QUOTE_STATUSES)[number];
  if (!QUOTE_STATUSES.includes(status)) return result(request, "error");
  const db = getDb();
  const before = await db.select({ id: quoteRequests.id, status: quoteRequests.status, requestNumber: quoteRequests.requestNumber }).from(quoteRequests).where(eq(quoteRequests.id, id)).get();
  if (!before) return result(request, "error");
  try {
    await db.batch([
      db.update(quoteRequests).set({ status, updatedAt: recordTimestamp() }).where(eq(quoteRequests.id, id)),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "UPDATE_QUOTATION_STATUS", entityType: "quote_request", entityId: id, before: { status: before.status }, after: { status, requestNumber: before.requestNumber } })),
    ]);
    return result(request, "updated");
  } catch {
    return result(request, "error");
  }
}

function result(request: NextRequest, value: "updated" | "error") {
  const url = new URL("/app/quotations", request.url);
  url.searchParams.set("result", value);
  return NextResponse.redirect(url, 303);
}
