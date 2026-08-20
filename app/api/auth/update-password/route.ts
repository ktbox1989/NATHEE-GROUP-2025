import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { isSameOrigin } from "@/lib/same-origin";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  if (!getSupabaseConfig()) {
    return NextResponse.redirect(
      new URL("/reset-password?error=config", request.url),
      303,
    );
  }
  if (password.length < 8 || password !== confirmation) {
    return NextResponse.redirect(
      new URL("/reset-password?error=invalid_password", request.url),
      303,
    );
  }

  const { client, applyAuthCookies } = createSupabaseRouteClient(request);
  const { data, error: userError } = await client.auth.getUser();
  if (userError || !data.user) {
    return applyAuthCookies(
      NextResponse.redirect(
        new URL("/forgot-password?error=expired", request.url),
        303,
      ),
    );
  }

  const { error } = await client.auth.updateUser({ password });
  if (error) {
    return applyAuthCookies(
      NextResponse.redirect(
        new URL("/reset-password?error=provider", request.url),
        303,
      ),
    );
  }

  await client.auth.signOut();
  return applyAuthCookies(
    NextResponse.redirect(
      new URL("/login?status=password_updated", request.url),
      303,
    ),
  );
}
