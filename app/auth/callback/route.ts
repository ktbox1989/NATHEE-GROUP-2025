import { NextResponse, type NextRequest } from "next/server";
import { getAppOrigin } from "@/lib/app-origin";
import { authIdentityId } from "@/lib/auth-identity";
import {
  recoveryGrantCookieOptions,
  RECOVERY_GRANT_COOKIE,
  shouldIssueRecoveryGrant,
} from "@/lib/auth-recovery-grant";
import { issueRecoveryGrant } from "@/lib/auth-recovery-grant-store";
import { safeReturnTo } from "@/lib/safe-return-to";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const appOrigin = getAppOrigin(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeReturnTo(requestUrl.searchParams.get("next"));

  if (!getSupabaseConfig() || !appOrigin) {
    return NextResponse.redirect(new URL("/login?error=config", request.url), 303);
  }
  if (requestUrl.origin !== appOrigin) {
    return NextResponse.redirect(new URL("/login?error=origin", appOrigin), 303);
  }
  if (!code) {
    return NextResponse.redirect(
      new URL("/forgot-password?error=expired", appOrigin),
      303,
    );
  }

  const { client, applyAuthCookies } = createSupabaseRouteClient(request);
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  if (error) {
    return applyAuthCookies(
      NextResponse.redirect(
        new URL("/forgot-password?error=expired", appOrigin),
        303,
      ),
    );
  }

  const response = applyAuthCookies(
    NextResponse.redirect(new URL(next, appOrigin), 303),
  );

  // This is the only place in the application where a link sent to a mailbox
  // becomes a session, so it is the only place that can attest a password change
  // was authorised by something other than possession of a session cookie.
  if (shouldIssueRecoveryGrant(next)) {
    const externalAuthId = authIdentityId(data.user);
    if (!externalAuthId) {
      return NextResponse.redirect(
        new URL("/forgot-password?error=expired", appOrigin),
        303,
      );
    }
    let token: string;
    try {
      token = await issueRecoveryGrant(externalAuthId);
    } catch {
      // Without a recorded grant the reset page would silently fall back to
      // demanding a password the recovering user does not have. Say so instead.
      return NextResponse.redirect(
        new URL("/forgot-password?error=unavailable", appOrigin),
        303,
      );
    }
    response.cookies.set(
      RECOVERY_GRANT_COOKIE,
      token,
      recoveryGrantCookieOptions(request.url),
    );
  }

  return response;
}
