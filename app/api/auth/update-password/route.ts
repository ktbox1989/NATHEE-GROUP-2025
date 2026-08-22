import { NextResponse, type NextRequest } from "next/server";
import { authIdentityId } from "@/lib/auth-identity";
import {
  clearedRecoveryGrantCookieOptions,
  isRecoveryGrantToken,
  passwordChangeAccepted,
  RECOVERY_GRANT_COOKIE,
  validPasswordChange,
  type PasswordChangeProof,
} from "@/lib/auth-recovery-grant";
import { consumeRecoveryGrant } from "@/lib/auth-recovery-grant-store";
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
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  const currentPassword = String(formData.get("currentPassword") ?? "");

  if (!getSupabaseConfig()) {
    return NextResponse.redirect(
      new URL("/reset-password?error=config", request.url),
      303,
    );
  }
  if (!validPasswordChange({ password, confirmation })) {
    return NextResponse.redirect(
      new URL("/reset-password?error=invalid_password", request.url),
      303,
    );
  }

  const { client, applyAuthCookies } = createSupabaseRouteClient(request);
  const { data, error: userError } = await client.auth.getUser();
  const externalAuthId = authIdentityId(data.user);
  if (userError || !externalAuthId) {
    return applyAuthCookies(
      NextResponse.redirect(
        new URL("/forgot-password?error=expired", request.url),
        303,
      ),
    );
  }

  // Holding a session is not proof of being the account holder. Whoever reaches
  // an unlocked browser or lifts a session cookie would otherwise take the
  // account over permanently — for OWNER, that is the whole platform.
  let proof: PasswordChangeProof = "none";
  const grantToken = request.cookies.get(RECOVERY_GRANT_COOKIE)?.value;
  if (isRecoveryGrantToken(grantToken)) {
    try {
      if (await consumeRecoveryGrant(grantToken!, externalAuthId)) proof = "grant";
    } catch {
      return applyAuthCookies(
        NextResponse.redirect(
          new URL("/reset-password?error=unavailable", request.url),
          303,
        ),
      );
    }
  }

  if (proof === "none" && currentPassword) {
    // Verifying the current password is a password guess like any other, so it
    // spends the same budget a guess at /api/auth/login would.
    const email = normalizeIdentitySubject(data.user?.email ?? "");
    if (!email) {
      return applyAuthCookies(
        NextResponse.redirect(
          new URL("/forgot-password?error=expired", request.url),
          303,
        ),
      );
    }
    let reservation: AuthThrottleReservation;
    try {
      reservation = await reserveAuthAttempt(
        authThrottleTargets("login", email, trustedClientAddress(request.headers)),
      );
    } catch {
      return applyAuthCookies(
        NextResponse.redirect(
          new URL("/reset-password?error=unavailable", request.url),
          303,
        ),
      );
    }
    if (!reservation.allowed) {
      return applyAuthCookies(
        NextResponse.redirect(
          new URL(
            `/reset-password?error=too_many_attempts&retryAfter=${reservation.retryAfterSeconds}`,
            request.url,
          ),
          303,
        ),
      );
    }
    const { error: reauthError } = await client.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    await settleAuthAttempt(reservation, reauthError ? "failure" : "success").catch(() => {});
    if (!reauthError) proof = "password";
  }

  if (!passwordChangeAccepted(proof)) {
    return applyAuthCookies(
      NextResponse.redirect(
        new URL("/reset-password?error=reauthenticate", request.url),
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
  const response = applyAuthCookies(
    NextResponse.redirect(
      new URL("/login?status=password_updated", request.url),
      303,
    ),
  );
  // The grant is spent whether it was used or not; nothing should carry it back
  // to the browser.
  response.cookies.set(
    RECOVERY_GRANT_COOKIE,
    "",
    clearedRecoveryGrantCookieOptions(request.url),
  );
  return response;
}
