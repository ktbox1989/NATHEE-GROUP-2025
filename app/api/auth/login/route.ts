import { NextResponse, type NextRequest } from "next/server";
import { safeReturnTo } from "@/lib/safe-return-to";
import { isSameOrigin } from "@/lib/same-origin";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const returnTo = safeReturnTo(formData.get("returnTo"));

  if (!getSupabaseConfig()) {
    return NextResponse.redirect(new URL("/login?error=config", request.url), 303);
  }
  if (!email || !password) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_input", request.url),
      303,
    );
  }

  const { client, applyAuthCookies } = createSupabaseRouteClient(request);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    return applyAuthCookies(
      NextResponse.redirect(
        new URL("/login?error=invalid_credentials", request.url),
        303,
      ),
    );
  }

  return applyAuthCookies(
    NextResponse.redirect(new URL(returnTo, request.url), 303),
  );
}
