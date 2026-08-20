import { NextResponse, type NextRequest } from "next/server";
import { buildAuthCallbackUrl, getAppOrigin } from "@/lib/app-origin";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { isSameOrigin } from "@/lib/same-origin";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const appOrigin = getAppOrigin(request.url);
  const callbackUrl = buildAuthCallbackUrl("/reset-password", request.url);

  if (!getSupabaseConfig() || !appOrigin || !callbackUrl) {
    return NextResponse.redirect(
      new URL("/forgot-password?error=config", request.url),
      303,
    );
  }
  if (!email) {
    return NextResponse.redirect(
      new URL("/forgot-password?error=invalid_input", request.url),
      303,
    );
  }

  const { client, applyAuthCookies } = createSupabaseRouteClient(request);
  await client.auth.resetPasswordForEmail(email, {
    redirectTo: callbackUrl.toString(),
  });

  // Always show the same result so the page does not reveal whether an email
  // address exists in the authentication provider.
  return applyAuthCookies(
    NextResponse.redirect(
      new URL("/forgot-password?sent=1", appOrigin),
      303,
    ),
  );
}
