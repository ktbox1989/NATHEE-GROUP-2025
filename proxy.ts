import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/app/:path*",
    "/portal/:path*",
    "/auth/:path*",
    "/api/auth/:path*",
    "/api/:path*",
  ],
};
