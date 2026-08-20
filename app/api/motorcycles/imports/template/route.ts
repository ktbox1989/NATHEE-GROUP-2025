import { NextResponse } from "next/server";
import { can, isInternalRole } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";

const header = "make,model,variant,year,color,registration,province,vin,engine_number,condition,notes\r\n";

export async function GET() {
  const actor = await getCurrentActor();
  if (!actor || !isInternalRole(actor.role) || !can(actor, "motorcycles:write")) return new NextResponse("Not Found", { status: 404 });
  return new NextResponse(`\uFEFF${header}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="nathee-motorcycle-import-template.csv"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
