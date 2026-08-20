import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { isSameOrigin } from "@/lib/same-origin";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  if (!getSupabaseConfig()) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const { client, applyAuthCookies } = createSupabaseRouteClient(request);
  await client.auth.signOut();
  return applyAuthCookies(
    NextResponse.redirect(new URL("/login?status=logged_out", request.url), 303),
  );
}
