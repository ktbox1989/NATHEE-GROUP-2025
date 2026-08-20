import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, quoteRequests } from "@/db/schema";
import { nextBusinessNumber } from "@/lib/business-numbers";
import { parseQuotationForm } from "@/lib/quotation";
import { isSameOrigin } from "@/lib/same-origin";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirect(request, "error", "invalid");
  }
  const parsed = parseQuotationForm(form);
  if (!parsed.ok) return redirect(request, "error", parsed.error);

  const db = getDb();
  try {
    const existing = await db.select({ requestNumber: quoteRequests.requestNumber }).from(quoteRequests).where(eq(quoteRequests.requestKey, parsed.value.requestKey)).get();
    if (existing) return redirect(request, "submitted", existing.requestNumber);

    const id = crypto.randomUUID();
    const requestNumber = await nextBusinessNumber("QT");
    const consentAt = new Date().toISOString();
    await db.batch([
      db.insert(quoteRequests).values({
        id,
        requestNumber,
        requestKey: parsed.value.requestKey,
        source: "PUBLIC_WEBSITE",
        companyName: parsed.value.companyName,
        contactName: parsed.value.contactName,
        phone: parsed.value.phone,
        lineId: parsed.value.lineId,
        email: parsed.value.email,
        origin: parsed.value.origin,
        destination: parsed.value.destination,
        quantity: parsed.value.quantity,
        vehicleType: parsed.value.vehicleType,
        desiredDate: parsed.value.desiredDate,
        extrasJson: JSON.stringify(parsed.value.extras),
        notes: parsed.value.notes,
        consentAt,
        status: "NEW",
      }),
      db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        actorUserId: null,
        companyId: null,
        action: "PUBLIC_QUOTATION_SUBMIT",
        entityType: "quote_request",
        entityId: id,
        beforeJson: null,
        afterJson: JSON.stringify({ requestNumber, source: "PUBLIC_WEBSITE", quantity: parsed.value.quantity, extras: parsed.value.extras }),
        reason: "Customer consent recorded with quotation request",
      }),
    ]);
    return redirect(request, "submitted", requestNumber);
  } catch {
    try {
      const existing = await db.select({ requestNumber: quoteRequests.requestNumber }).from(quoteRequests).where(eq(quoteRequests.requestKey, parsed.value.requestKey)).get();
      if (existing) return redirect(request, "submitted", existing.requestNumber);
    } catch {
      // Fail closed below; no success is shown without a durable D1 record.
    }
    return redirect(request, "error", "save");
  }
}

function redirect(request: NextRequest, key: "submitted" | "error", value: string) {
  const url = new URL("/quotation", request.url);
  url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}
