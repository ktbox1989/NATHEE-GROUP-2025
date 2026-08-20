import { NextResponse, type NextRequest } from "next/server";
import { safeReturnTo } from "@/lib/safe-return-to";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeReturnTo(requestUrl.searchParams.get("next"));

  if (!getSupabaseConfig()) {
    return NextResponse.redirect(new URL("/login?error=config", request.url), 303);
  }
  if (!code) {
    return NextResponse.redirect(
      new URL("/forgot-password?error=expired", request.url),
      303,
    );
  }

  const { client, applyAuthCookies } = createSupabaseRouteClient(request);
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) {
    return applyAuthCookies(
      NextResponse.redirect(
        new URL("/forgot-password?error=expired", request.url),
        303,
      ),
    );
  }

  return applyAuthCookies(
    NextResponse.redirect(new URL(next, request.url), 303),
  );
}
