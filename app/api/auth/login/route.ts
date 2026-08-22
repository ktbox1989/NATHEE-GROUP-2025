import { NextResponse, type NextRequest } from "next/server";
import { authIdentityId } from "@/lib/auth-identity";
import { recordSignInEvent } from "@/lib/auth-events-store";
import { authThrottleTargets, normalizeIdentitySubject } from "@/lib/auth-throttle";
import {
  reserveAuthAttempt,
  settleAuthAttempt,
  type AuthThrottleReservation,
} from "@/lib/auth-throttle-store";
import { trustedClientAddress } from "@/lib/client-address";
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
  const identitySubject = password ? normalizeIdentitySubject(email) : null;
  if (!identitySubject) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_input", request.url),
      303,
    );
  }

  // Spend the attempt budget before the provider is asked anything. A request
  // that dies inside the provider call has still spent its attempt.
  let reservation: AuthThrottleReservation;
  try {
    reservation = await reserveAuthAttempt(
      authThrottleTargets("login", identitySubject, trustedClientAddress(request.headers)),
    );
  } catch {
    // A counter this route cannot reach is not a licence to guess passwords.
    return NextResponse.redirect(
      new URL("/login?error=unavailable", request.url),
      303,
    );
  }
  if (!reservation.allowed) {
    return NextResponse.redirect(
      new URL(
        `/login?error=too_many_attempts&retryAfter=${reservation.retryAfterSeconds}`,
        request.url,
      ),
      303,
    );
  }

  const { client, applyAuthCookies } = createSupabaseRouteClient(request);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  // The attempt is already recorded as spent; settling only escalates a spent
  // window into a lockout, or releases a proven identity. Neither may turn a
  // provider answer into a different one, so a settlement failure is swallowed.
  await settleAuthAttempt(reservation, error ? "failure" : "success").catch(() => {});

  if (error) {
    return applyAuthCookies(
      NextResponse.redirect(
        new URL("/login?error=invalid_credentials", request.url),
        303,
      ),
    );
  }

  // Until now the Audit trail recorded what people changed but never that they
  // got in, so a compromised account left no trace unless it also changed
  // something. Best effort on purpose: the counter above already proved the
  // database was reachable, and a lost trail entry must not cost a real user
  // their login.
  const externalAuthId = authIdentityId(data.user);
  if (externalAuthId) {
    await recordSignInEvent(externalAuthId, "password").catch(() => {});
  }

  return applyAuthCookies(
    NextResponse.redirect(new URL(returnTo, request.url), 303),
  );
}
