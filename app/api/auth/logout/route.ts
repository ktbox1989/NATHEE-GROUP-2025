import { NextResponse, type NextRequest } from "next/server";
import { clearedOwnerSessionCookieOptions, OWNER_PIN_COOKIE } from "@/lib/owner-pin";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { isSameOrigin } from "@/lib/same-origin";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

/**
 * Ends whichever session exists, and does not require the one it is asked about
 * to be configured.
 *
 * This route used to return early when Supabase was absent, which with an Owner
 * PIN session in the browser would have been a sign-out button that signed
 * nobody out. Clearing a cookie that is not there costs one header and is the
 * only behaviour that stays correct as the two doors are turned on and off
 * independently.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });

  const redirect = NextResponse.redirect(
    new URL("/login?status=logged_out", request.url),
    303,
  );
  redirect.cookies.set(OWNER_PIN_COOKIE, "", clearedOwnerSessionCookieOptions());

  if (!getSupabaseConfig()) return redirect;

  const { client, applyAuthCookies } = createSupabaseRouteClient(request);
  await client.auth.signOut();
  return applyAuthCookies(redirect);
}
