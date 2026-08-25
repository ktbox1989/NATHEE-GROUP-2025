import { NextResponse, type NextRequest } from "next/server";
import { getD1 } from "@/db";
import { recordSignInEvent } from "@/lib/auth-events-store";
import { authThrottleTargets, normalizeIdentitySubject } from "@/lib/auth-throttle";
import {
  reserveAuthAttempt,
  settleAuthAttempt,
  type AuthThrottleReservation,
} from "@/lib/auth-throttle-store";
import { trustedClientAddress } from "@/lib/client-address";
import {
  createOwnerSessionToken,
  getOwnerPinAuthConfig,
  isSixDigitPin,
  ownerCredentialFingerprint,
  ownerSessionCookieOptions,
  ownerSessionPayload,
  verifyOwnerPin,
  OWNER_EMAIL,
  OWNER_EXTERNAL_AUTH_ID,
  OWNER_PIN_COOKIE,
} from "@/lib/owner-pin";
import type { OwnerBootstrapOutcome } from "@/lib/owner-pin-identity";
import { ensureOwnerPinIdentity } from "@/lib/owner-pin-store";
import { safeReturnTo } from "@/lib/safe-return-to";
import { isSameOrigin } from "@/lib/same-origin";
import { logOwnerPinStageFailure } from "@/lib/owner-pin-diagnostics";

/**
 * The Owner's PIN door.
 *
 * The form sends two fields and no third. There is deliberately no email field:
 * the account this endpoint authenticates is a server constant, so a caller
 * cannot aim the attempt at a different account, cannot spend another account's
 * lockout budget, and cannot turn a leaked PIN into a login to anything but the
 * one seat it belongs to.
 *
 * A six-digit PIN is only defensible with the budget in front of it, which is
 * why the reservation is taken before the verifier runs — the same order, and
 * the same counters, as the password login. The identity subject is the Owner's
 * own address, so the two doors share one budget: guessing at the PIN and
 * guessing at the password cannot each get their own five attempts.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });

  const formData = await request.formData();
  const pin = String(formData.get("pin") ?? "");
  const rawReturnTo = formData.get("returnTo");
  const returnTo = safeReturnTo(rawReturnTo);

  // A refusal must not also cost the Owner the page they were trying to reach.
  // A protected route sends them here with that path, the login page renders it
  // into the form, and dropping it on every error means one mistyped digit —
  // which a six-digit PIN invites — silently relocates them to the default
  // destination.
  //
  // Only a path the form actually sent and that survived sanitising is carried:
  // `safeReturnTo` answers "/app" both for a genuine "/app" and for a value it
  // refused, so echoing the fallback of a refused value would quietly overwrite
  // the login page's own default with one the caller chose the shape of. What
  // goes back is the sanitised path, never the raw one.
  const carriedReturnTo =
    typeof rawReturnTo === "string" && (returnTo !== "/app" || rawReturnTo === "/app")
      ? `&returnTo=${encodeURIComponent(returnTo)}`
      : "";

  const config = getOwnerPinAuthConfig();
  if (!config) {
    return NextResponse.redirect(new URL(`/login?error=config${carriedReturnTo}`, request.url), 303);
  }

  // Exactly six ASCII digits, checked before anything is spent. A value of the
  // wrong shape cannot be the PIN, so refusing it costs the caller nothing and
  // keeps a paste of a whole password out of the verifier.
  if (!isSixDigitPin(pin)) {
    return NextResponse.redirect(new URL(`/login?error=pin_format${carriedReturnTo}`, request.url), 303);
  }

  const identitySubject = normalizeIdentitySubject(OWNER_EMAIL) ?? OWNER_EMAIL;

  let reservation: AuthThrottleReservation;
  try {
    reservation = await reserveAuthAttempt(
      authThrottleTargets("login", identitySubject, trustedClientAddress(request.headers)),
    );
  } catch (error) {
    logOwnerPinStageFailure("throttle", error, request.headers);
    // A counter this route cannot reach is not a licence to guess a six-digit PIN.
    return NextResponse.redirect(new URL(`/login?error=unavailable${carriedReturnTo}`, request.url), 303);
  }
  if (!reservation.allowed) {
    return NextResponse.redirect(
      new URL(
        `/login?error=too_many_attempts&retryAfter=${reservation.retryAfterSeconds}${carriedReturnTo}`,
        request.url,
      ),
      303,
    );
  }

  let accepted: boolean;
  try {
    accepted = await verifyOwnerPin(pin, config.credential);
  } catch (error) {
    logOwnerPinStageFailure("verify", error, request.headers);
    // A verifier/runtime failure is not evidence that the Owner typed the
    // wrong PIN. Fail closed, settle the reserved attempt, and return to the
    // login page with the existing operational-error code instead of exposing
    // a blank 500 response at the POST endpoint.
    await settleAuthAttempt(reservation, "failure").catch(() => {});
    return NextResponse.redirect(new URL(`/login?error=unavailable${carriedReturnTo}`, request.url), 303);
  }
  await settleAuthAttempt(reservation, accepted ? "success" : "failure").catch(() => {});

  if (!accepted) {
    return NextResponse.redirect(new URL(`/login?error=invalid_pin${carriedReturnTo}`, request.url), 303);
  }

  // The PIN is right, so the Owner account has to exist. Idempotent, and it
  // refuses rather than rebinds if the canonical address already belongs to
  // something else — a correct PIN is proof of the PIN, not a warrant to take
  // an existing account over.
  let bootstrap: OwnerBootstrapOutcome;
  try {
    bootstrap = await ensureOwnerPinIdentity(getD1());
  } catch (error) {
    logOwnerPinStageFailure("bootstrap", error, request.headers);
    return NextResponse.redirect(new URL(`/login?error=unavailable${carriedReturnTo}`, request.url), 303);
  }
  if (!bootstrap.ok) {
    return NextResponse.redirect(new URL(`/login?error=owner_conflict${carriedReturnTo}`, request.url), 303);
  }

  // Best effort, exactly as the password login treats it: the counter above
  // already proved the database was reachable, and a lost trail entry must not
  // cost the Owner their login.
  await recordSignInEvent(OWNER_EXTERNAL_AUTH_ID, "owner_pin").catch(() => {});

  const token = await createOwnerSessionToken(
    ownerSessionPayload(
      bootstrap.userId,
      await ownerCredentialFingerprint(config.encodedCredential),
      Date.now(),
    ),
    config.sessionSecret,
  );

  const response = NextResponse.redirect(new URL(returnTo, request.url), 303);
  response.cookies.set(OWNER_PIN_COOKIE, token, ownerSessionCookieOptions());
  return response;
}
