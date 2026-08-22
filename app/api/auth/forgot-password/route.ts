import { NextResponse, type NextRequest } from "next/server";
import { buildAuthCallbackUrl, getAppOrigin } from "@/lib/app-origin";
import { authThrottleTargets, normalizeIdentitySubject } from "@/lib/auth-throttle";
import {
  reserveAuthAttempt,
  settleAuthAttempt,
  type AuthThrottleReservation,
} from "@/lib/auth-throttle-store";
import { trustedClientAddress } from "@/lib/client-address";
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
  const identitySubject = normalizeIdentitySubject(email);
  if (!identitySubject) {
    return NextResponse.redirect(
      new URL("/forgot-password?error=invalid_input", request.url),
      303,
    );
  }

  // This endpoint sends real mail to a real inbox on an unauthenticated
  // request. Unbounded, it bombs the mailbox of anyone whose address is guessed
  // and exhausts the provider's send quota, which denies recovery to the
  // account that actually needs it.
  let reservation: AuthThrottleReservation;
  try {
    reservation = await reserveAuthAttempt(
      authThrottleTargets("recovery", identitySubject, trustedClientAddress(request.headers)),
    );
  } catch {
    return NextResponse.redirect(
      new URL("/forgot-password?error=unavailable", request.url),
      303,
    );
  }
  if (!reservation.allowed) {
    return NextResponse.redirect(
      new URL(
        `/forgot-password?error=too_many_attempts&retryAfter=${reservation.retryAfterSeconds}`,
        request.url,
      ),
      303,
    );
  }

  const { client, applyAuthCookies } = createSupabaseRouteClient(request);
  await client.auth.resetPasswordForEmail(email, {
    redirectTo: callbackUrl.toString(),
  });
  // Recovery has no success signal this route is allowed to observe: the reply
  // is identical whether or not the address exists, so the counter is told the
  // same thing. Every request stays spent and an exhausted budget escalates.
  await settleAuthAttempt(reservation, "failure").catch(() => {});

  // Always show the same result so the page does not reveal whether an email
  // address exists in the authentication provider.
  return applyAuthCookies(
    NextResponse.redirect(
      new URL("/forgot-password?sent=1", appOrigin),
      303,
    ),
  );
}
