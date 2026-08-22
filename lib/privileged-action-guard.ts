import { authThrottleTargets, normalizeIdentitySubject } from "@/lib/auth-throttle";
import { reserveAuthAttempt, settleAuthAttempt } from "@/lib/auth-throttle-store";
import { trustedClientAddress } from "@/lib/client-address";
import { submittedCurrentPassword, type PrivilegedProof } from "@/lib/privileged-action";
import type { createSupabaseRouteClient } from "@/lib/supabase/route";

export type PrivilegedGuardOutcome =
  | { ok: true; proof: PrivilegedProof }
  | { ok: false; error: "reauthenticate" | "wrong_password" | "too_many_attempts" | "unavailable"; retryAfterSeconds?: number };

type RouteClient = ReturnType<typeof createSupabaseRouteClient>["client"];

/**
 * Requires the actor to prove they are still the account holder before a
 * privileged write proceeds.
 *
 * Verifying the password is a password guess, so it reserves from the same
 * budgets a guess at `/api/auth/login` would, before the provider is asked
 * anything. A counter this cannot reach refuses the write rather than waving it
 * through — an unavailable throttle is not a licence to change who holds OWNER.
 */
export async function requireCurrentPassword(input: {
  client: RouteClient;
  email: string | undefined;
  submitted: FormDataEntryValue | null;
  headers: Headers;
}): Promise<PrivilegedGuardOutcome> {
  const password = submittedCurrentPassword(input.submitted);
  const email = normalizeIdentitySubject(input.email ?? "");
  if (!password || !email) return { ok: false, error: "reauthenticate" };

  let reservation;
  try {
    reservation = await reserveAuthAttempt(
      authThrottleTargets("login", email, trustedClientAddress(input.headers)),
    );
  } catch {
    return { ok: false, error: "unavailable" };
  }
  if (!reservation.allowed) {
    return { ok: false, error: "too_many_attempts", retryAfterSeconds: reservation.retryAfterSeconds };
  }

  const { error } = await input.client.auth.signInWithPassword({ email, password });
  await settleAuthAttempt(reservation, error ? "failure" : "success").catch(() => {});
  if (error) return { ok: false, error: "wrong_password" };
  return { ok: true, proof: "current_password" };
}
