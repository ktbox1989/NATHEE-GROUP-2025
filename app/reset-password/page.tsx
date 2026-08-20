import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata = {
  title: "ตั้งรหัสผ่านใหม่ | NATHEE GROUP 2025",
};

const errorMessages: Record<string, string> = {
  config: "ระบบยืนยันตัวตนยังไม่ได้เชื่อมกับบัญชีผู้ให้บริการ",
  invalid_password: "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวและกรอกให้ตรงกัน",
  provider: "ไม่สามารถเปลี่ยนรหัสผ่านได้ กรุณาขอลิงก์ใหม่",
};

type ResetPasswordPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const configured = isSupabaseConfigured();
  const error = params.error ? errorMessages[params.error] : null;

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
          รหัสผ่านควรยาวอย่างน้อย 8 ตัวอักษรและไม่ใช้ซ้ำกับระบบอื่น
        </p>
        {error && <div className="form-message error" role="alert">{error}</div>}

        <form action="/api/auth/update-password" method="post">
          <div className="field">
            <label htmlFor="password">รหัสผ่านใหม่</label>
            <input
              id="password"
              name="password"
              type="password"
              minLength={8}
              autoComplete="new-password"
              required
              disabled={!configured}
            />
          </div>
          <div className="field">
            <label htmlFor="confirmation">ยืนยันรหัสผ่านใหม่</label>
            <input
              id="confirmation"
              name="confirmation"
              type="password"
              minLength={8}
              autoComplete="new-password"
              required
              disabled={!configured}
            />
          </div>
          <button
            className="button button-gradient login-submit"
            type="submit"
            disabled={!configured}
          >
            บันทึกรหัสผ่านใหม่
          </button>
        </form>
        <div className="auth-links single">
          <Link href="/login">← กลับหน้าเข้าสู่ระบบ</Link>
        </div>
      </section>
    </main>
  );
}
