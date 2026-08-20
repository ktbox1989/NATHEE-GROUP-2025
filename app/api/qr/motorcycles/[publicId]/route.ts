import { eq } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { getDb } from "@/db";
import { motorcycles } from "@/db/schema";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { isMotorcyclePublicId } from "@/lib/qr";
import { renderMotorcycleQrSvg } from "@/lib/qr-svg";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ publicId: string }> },
) {
  const actor = await getCurrentActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });

  const { publicId } = await context.params;
  if (!isMotorcyclePublicId(publicId)) {
    return new Response("Not found", { status: 404 });
  }

  const record = await getDb()
    .select({ companyId: motorcycles.companyId })
    .from(motorcycles)
    .where(eq(motorcycles.publicId, publicId))
    .get();
  if (!record || !can(actor, "motorcycles:read", record.companyId)) {
    return new Response("Not found", { status: 404 });
  }

  const svg = await renderMotorcycleQrSvg(publicId);
  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename="nathee-${publicId}.svg"`,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
