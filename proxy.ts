import { NextResponse, type NextRequest } from "next/server";
import { canonicalPublicRedirectUrl } from "@/lib/canonical-public-redirect";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const canonicalDestination = canonicalPublicRedirectUrl(request.nextUrl);
  if (canonicalDestination) return NextResponse.redirect(canonicalDestination, 308);
  return updateSession(request);
}

/**
 * Every path that reads a session has to be here.
 *
 * A Server Component cannot write cookies, so when it refreshes an expired
 * access token the rotated refresh token is discarded — and the browser is left
 * holding one the provider has already consumed. The next request then cannot
 * refresh at all, and the person is signed out. This is the only place a refresh
 * is persisted, which is why `lib/supabase/server.ts` says a protected page is
 * refreshed here before it renders.
 *
 * `/reset-password` reads a session to decide whether to ask for the current
 * password, so a signed-in user returning after an idle period needs it too.
 *
 * `scripts/test-session-refresh-coverage.mjs` fails the build if a session
 * reader is added outside this list.
 */
export const config = {
  matcher: [
    // Duplicate public presentation exists here only as a CMS-backed source.
    // On the Production application hostname it permanently hands off to the
    // canonical apex; on local and preview hosts the pages remain testable.
    "/",
    "/services/:path*",
    "/motorcycle-transport/:path*",
    "/international/:path*",
    "/storage/:path*",
    "/container-loading/:path*",
    "/dealer-fleet/:path*",
    "/gallery/:path*",
    "/about/:path*",
    "/contact/:path*",
    "/quotation/:path*",
    "/news/:path*",
    "/sitemap.xml",
    "/app/:path*",
    "/portal/:path*",
    "/auth/:path*",
    "/api/auth/:path*",
    "/api/:path*",
    "/reset-password",
  ],
};
