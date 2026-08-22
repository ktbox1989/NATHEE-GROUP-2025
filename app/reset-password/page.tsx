import { cookies } from "next/headers";
import Link from "next/link";
import { authIdentityId } from "@/lib/auth-identity";
import {
  isRecoveryGrantToken,
  MIN_PASSWORD_LENGTH,
  RECOVERY_GRANT_COOKIE,
} from "@/lib/auth-recovery-grant";
import { hasUsableRecoveryGrant } from "@/lib/auth-recovery-grant-store";
import { retryAfterMinutes } from "@/lib/auth-throttle";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "ตั้งรหัสผ่านใหม่ | NATHEE GROUP 2025",
};

const errorMessages: Record<string, string> = {
  config: "ระบบยืนยันตัวตนยังไม่ได้เชื่อมกับบัญชีผู้ให้บริการ",
  invalid_password: "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวและกรอกให้ตรงกัน",
  provider: "ไม่สามารถเปลี่ยนรหัสผ่านได้ กรุณาขอลิงก์ใหม่",
  reauthenticate: "ต้องยืนยันตัวตนก่อนเปลี่ยนรหัสผ่าน กรุณากรอกรหัสผ่านปัจจุบันให้ถูกต้อง หรือขอลิงก์ตั้งรหัสผ่านใหม่ทางอีเมล",
  too_many_attempts: "ยืนยันรหัสผ่านปัจจุบันผิดบ่อยเกินไป ระบบระงับการลองชั่วคราว",
  unavailable: "ระบบยืนยันตัวตนไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่ภายหลัง",
};

type ResetPasswordPageProps = {
  searchParams: Promise<{ error?: string; retryAfter?: string }>;
};

/**
 * Which proof this visitor can offer. `link` means they arrived through a
 * recovery or invitation mail and may set a password without knowing the old
 * one; `password` means they hold a session and must prove they are the account
 * holder; the rest are honest dead ends rather than a form that cannot work.
 */
type ProofState = "link" | "password" | "signed_out" | "unavailable";

async function resolveProofState(): Promise<ProofState> {
  if (!isSupabaseConfigured()) return "unavailable";

  let externalAuthId: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    externalAuthId = error ? null : authIdentityId(data.user);
  } catch {
    return "unavailable";
  }
  if (!externalAuthId) return "signed_out";

  const token = (await cookies()).get(RECOVERY_GRANT_COOKIE)?.value;
  if (!isRecoveryGrantToken(token)) return "password";
  try {
    // Read-only on purpose: rendering this page must never spend the grant.
    return (await hasUsableRecoveryGrant(token!, externalAuthId)) ? "link" : "password";
  } catch {
    return "unavailable";
  }
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const proofState = await resolveProofState();
  const baseError = params.error ? errorMessages[params.error] : null;
  const waitMinutes =
    params.error === "too_many_attempts" ? retryAfterMinutes(params.retryAfter) : null;
  const error =
    baseError && waitMinutes
      ? `${baseError} กรุณาลองใหม่ในอีกประมาณ ${waitMinutes} นาที`
      : baseError;
  const canSubmit = proofState === "link" || proofState === "password";

  return (
    <main className="login-page">
      <div className="aurora" aria-hidden="true">
        <i className="aurora-one" />
        <i className="aurora-two" />
      </div>
      <section className="login-card" aria-labelledby="reset-title">
        <Link className="brand" href="/">
          <span className="brand-mark">NG</span>
          <span className="brand-name">
            NATHEE GROUP<small>LOGISTICS SYSTEM</small>
          </span>
        </Link>
        <h1 id="reset-title">ตั้งรหัสผ่านใหม่</h1>
        <p className="login-subtitle">
          รหัสผ่านควรยาวอย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษรและไม่ใช้ซ้ำกับระบบอื่น
        </p>
        {error && <div className="form-message error" role="alert">{error}</div>}

        {proofState === "signed_out" && (
          <div className="form-message error" role="alert">
            ลิงก์หมดอายุหรือยังไม่ได้เข้าสู่ระบบ กรุณาขอลิงก์ตั้งรหัสผ่านใหม่ทางอีเมล
          </div>
        )}
        {proofState === "unavailable" && (
          <div className="form-message error" role="alert">
            {errorMessages.unavailable}
          </div>
        )}
        {proofState === "password" && (
          <div className="login-notice" role="status">
            ลิงก์ตั้งรหัสผ่านหมดอายุหรือถูกใช้ไปแล้ว
            กรุณายืนยันด้วยรหัสผ่านปัจจุบัน หรือขอลิงก์ใหม่ทางอีเมล
          </div>
        )}

        <form action="/api/auth/update-password" method="post">
          {proofState === "password" && (
            <div className="field">
              <label htmlFor="currentPassword">รหัสผ่านปัจจุบัน</label>
              <input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="password">รหัสผ่านใหม่</label>
            <input
              id="password"
              name="password"
              type="password"
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              required
              disabled={!canSubmit}
            />
          </div>
          <div className="field">
            <label htmlFor="confirmation">ยืนยันรหัสผ่านใหม่</label>
            <input
              id="confirmation"
              name="confirmation"
              type="password"
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              required
              disabled={!canSubmit}
            />
          </div>
          <button
            className="button button-gradient login-submit"
            type="submit"
            disabled={!canSubmit}
          >
            บันทึกรหัสผ่านใหม่
          </button>
        </form>
        <div className="auth-links">
          <Link href="/forgot-password">ขอลิงก์ตั้งรหัสผ่านใหม่</Link>
          <Link href="/login">← กลับหน้าเข้าสู่ระบบ</Link>
        </div>
      </section>
    </main>
  );
}
