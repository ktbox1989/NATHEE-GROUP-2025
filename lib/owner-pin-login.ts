import { retryAfterMinutes } from "./auth-throttle.ts";
import { safeReturnTo } from "./safe-return-to.ts";

/**
 * The Owner PIN login, from the browser's side only.
 *
 * Everything in this file is public by construction: a route path, two form
 * field names, the Owner's own address, the shape a PIN must have, and the Thai
 * sentence shown for each refusal the server can answer with. The PIN itself is
 * not here, is not in the page that imports this, and is not in any bundle — it
 * lives server-side, and the only thing this half ever does with one is post
 * what was typed into the field.
 */

/** The route the server owns. The login page posts here and nowhere else. */
export const OWNER_PIN_LOGIN_ACTION = "/api/auth/owner-pin/login";

/**
 * The single Owner identity, shown so the person at the keyboard can see which
 * account they are about to open — and deliberately not a form field.
 *
 * The server fixes this address. An address that travelled from the browser
 * would be a claim of authority made by the client, which is precisely what a
 * fixed-identity login exists to remove, so this constant is rendered as text
 * and never as an input, a hidden field or a submitted value.
 */
export const OWNER_LOGIN_EMAIL = "kaikt143@gmail.com";

/** Exactly six characters, and each one an ASCII digit. */
export const OWNER_PIN_LENGTH = 6;

/**
 * The `pattern` attribute of the PIN field, and the same rule the server is
 * expected to apply. ASCII `0-9` only: `\d` in an HTML pattern is Unicode-aware
 * and would accept Thai and Arabic-Indic digits, which no PIN comparison on the
 * other side would recognise, so the field would accept input that can only ever
 * be refused.
 */
export const OWNER_PIN_PATTERN = "[0-9]{6}";

/** The form field the server reads the PIN from. */
export const OWNER_PIN_FIELD = "pin";

/** The form field carrying where to land after a successful login. */
export const OWNER_RETURN_TO_FIELD = "returnTo";

/**
 * Where a direct login lands. The Owner signs in to edit the website, so the
 * website workspace is the destination rather than the operations dashboard.
 */
export const OWNER_PIN_DEFAULT_RETURN_TO = "/app/website";

/** Every refusal the login route can answer with. */
export const OWNER_PIN_ERROR_CODES = [
  "config",
  "invalid_input",
  "invalid_credentials",
  "not_authorized",
  "too_many_attempts",
  "unavailable",
] as const;

export type OwnerPinErrorCode = (typeof OWNER_PIN_ERROR_CODES)[number];

/**
 * One sentence per refusal, each saying what actually happened.
 *
 * None of them claims the Owner did something wrong when the server did, and
 * none of them offers a recovery path that does not exist: a PIN is held
 * server-side and cannot be reset from this screen, so no message pretends
 * otherwise.
 */
const ERROR_MESSAGES: Record<OwnerPinErrorCode, string> = {
  config:
    "ยังตั้งค่า PIN ของเจ้าของไว้ที่เซิร์ฟเวอร์ไม่ครบ จึงยังเข้าสู่ระบบไม่ได้ ต้องตั้งค่าที่เซิร์ฟเวอร์ก่อน ไม่ใช่ที่หน้านี้",
  invalid_input: "กรุณากรอก PIN ให้ครบ 6 หลัก และใช้ตัวเลข 0-9 เท่านั้น",
  invalid_credentials: "PIN ไม่ถูกต้อง กรุณากรอกใหม่อีกครั้ง",
  not_authorized: "ต้องเข้าสู่ระบบด้วย PIN ของเจ้าของก่อน จึงจะเปิดหน้าที่ขอไว้ได้",
  too_many_attempts:
    "กรอก PIN ผิดหลายครั้งเกินไป ระบบระงับการลองชั่วคราวเพื่อความปลอดภัย",
  unavailable: "ระบบเข้าสู่ระบบไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่ภายหลัง",
};

const STATUS_MESSAGES: Record<string, string> = {
  logged_out: "ออกจากระบบเรียบร้อยแล้ว",
  // /reset-password still redirects here with this status. The route is not the
  // Owner's path any more, but it exists, so its message is not dropped.
  password_updated: "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว กรุณาเข้าสู่ระบบอีกครั้ง",
};

export function isOwnerPinErrorCode(value: string | undefined): value is OwnerPinErrorCode {
  return typeof value === "string" && (OWNER_PIN_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * The message for one refusal, with the wait appended when there is one.
 *
 * A lockout is the only refusal that has a number attached, and the number only
 * ever shortens a wait the caller is already serving, so it is shown — but it is
 * parsed strictly by `retryAfterMinutes`, and an unparseable one becomes "รอสักครู่"
 * rather than a wrong or attacker-chosen figure. An unknown code renders nothing:
 * inventing a sentence for a code this UI does not know would be a guess shown to
 * the Owner as fact.
 */
export function ownerPinLoginError(
  code: string | undefined,
  retryAfter?: string,
): string | null {
  if (!isOwnerPinErrorCode(code)) return null;
  const message = ERROR_MESSAGES[code];
  if (code !== "too_many_attempts") return message;
  const minutes = retryAfterMinutes(retryAfter);
  return minutes === null
    ? `${message} กรุณารอสักครู่แล้วลองใหม่`
    : `${message} กรุณาลองใหม่ในอีกประมาณ ${minutes} นาที`;
}

/** The message for one status, or nothing for a code this UI does not know. */
export function ownerPinLoginStatus(code: string | undefined): string | null {
  if (!code) return null;
  return STATUS_MESSAGES[code] ?? null;
}

/**
 * Where a successful login should land.
 *
 * A protected route sends the Owner here with the path they were trying to
 * reach, and that path has to survive the round trip or the Owner is dropped on
 * a dashboard after every session expiry. It also arrives in a URL anyone can
 * write, so it is a same-origin path or it is not used at all.
 *
 * `safeReturnTo` is the one place that decides same-origin, and it is reused
 * rather than re-implemented. Its own fallback is `/app`, which is
 * indistinguishable from a caller who genuinely asked for `/app` — so a value
 * this function did not first accept as a path is refused before it gets there,
 * and a refusal that still surfaces as the bare fallback is treated as a refusal.
 */
export function ownerLoginReturnTo(value: string | null | undefined): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return OWNER_PIN_DEFAULT_RETURN_TO;
  }
  const resolved = safeReturnTo(value);
  if (resolved === "/app" && value !== "/app") return OWNER_PIN_DEFAULT_RETURN_TO;
  return resolved;
}
