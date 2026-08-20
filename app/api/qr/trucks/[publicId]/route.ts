import { type NextRequest } from "next/server";
import { operationalQrResponse } from "@/lib/operational-qr-route";

export async function GET(_request: NextRequest, context: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await context.params;
  return operationalQrResponse("truck", publicId);
}
