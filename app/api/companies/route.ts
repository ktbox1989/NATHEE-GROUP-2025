import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, companies } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "companies:write")) return NextResponse.redirect(new URL("/app", request.url), 303);

  const form = await request.formData();
  const code = String(form.get("code") ?? "").trim().toUpperCase();
  const displayName = String(form.get("displayName") ?? "").trim();
  const legalName = String(form.get("legalName") ?? "").trim();
  if (!/^[A-Z0-9-]{2,30}$/.test(code) || !displayName || !legalName) {
    return NextResponse.redirect(new URL("/app/companies?error=invalid", request.url), 303);
  }

  const id = crypto.randomUUID();
  const record = {
    id,
    code,
    displayName,
    legalName,
    contactName: optional(form, "contactName"),
    contactPhone: optional(form, "contactPhone"),
    contactEmail: optional(form, "contactEmail")?.toLowerCase() ?? null,
    taxId: optional(form, "taxId"),
  };

  try {
    const db = getDb();
    await db.batch([
      db.insert(companies).values(record),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "CREATE", entityType: "company", entityId: id, companyId: id, after: record })),
    ]);
  } catch {
    return NextResponse.redirect(new URL("/app/companies?error=duplicate", request.url), 303);
  }
  return NextResponse.redirect(new URL("/app/companies?status=created", request.url), 303);
}

function optional(form: FormData, name: string): string | null {
  const value = String(form.get(name) ?? "").trim();
  return value || null;
}
