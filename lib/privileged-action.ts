/**
 * Actions where holding a session is not enough.
 *
 * Inviting a member, changing a role or permission set, and disabling an account
 * are the operations that decide who may do anything at all. Until now each
 * needed only a session that resolved to OWNER — so anyone who reached an
 * unlocked browser, or lifted a session cookie, could invite a second OWNER and
 * keep that access after the real Owner changed their password. Persistence, not
 * just impersonation.
 *
 * The proof required is the actor's current password, verified through the
 * identity provider on the request that performs the write. There is
 * deliberately no "sudo window": a time-boxed grant is more state to store, more
 * lifetime to get wrong, and another cookie worth stealing. These actions are
 * rare and consequential, so each one carries its own proof.
 *
 * The verification is a password check like any other and spends the same
 * `login:*` attempt budgets, so it cannot be used as an unthrottled oracle.
 */

export const PRIVILEGED_ACTIONS = ["INVITE_MEMBER", "UPDATE_ACCESS"] as const;
export type PrivilegedAction = (typeof PRIVILEGED_ACTIONS)[number];

export type PrivilegedProof = "current_password" | "none";

export function privilegedProofAccepted(proof: PrivilegedProof): boolean {
  return proof === "current_password";
}

/**
 * The submitted password, bounded before it is forwarded. An absent value is not
 * an error to report differently from a wrong one: both mean the write is
 * refused, and distinguishing them tells an attacker which half to work on.
 */
export function submittedCurrentPassword(value: FormDataEntryValue | null): string {
  const password = typeof value === "string" ? value : "";
  return password.length > 0 && password.length <= 200 ? password : "";
}

/** The query key the admin pages use to ask for the password again. */
export const REAUTHENTICATION_ERROR = "reauthenticate";

/**
 * Thai copy for the admin surfaces. Kept beside the rule so a new privileged
 * action cannot be added with no way to tell the operator what happened.
 */
export const PRIVILEGED_ACTION_MESSAGES: Record<string, string> = {
  reauthenticate: "ต้องยืนยันรหัสผ่านปัจจุบันของคุณก่อนเปลี่ยนสิทธิ์หรือเชิญสมาชิก",
  wrong_password: "รหัสผ่านปัจจุบันไม่ถูกต้อง",
  too_many_attempts: "ยืนยันรหัสผ่านผิดบ่อยเกินไป ระบบระงับการลองชั่วคราว",
  unavailable: "ระบบยืนยันตัวตนไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่ภายหลัง",
};

export function privilegedActionMessage(code: string | undefined): string | null {
  if (!code) return null;
  return PRIVILEGED_ACTION_MESSAGES[code] ?? null;
}
