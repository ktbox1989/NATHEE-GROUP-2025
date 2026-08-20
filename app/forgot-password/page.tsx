import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata = {
  title: "ลืมรหัสผ่าน | NATHEE GROUP 2025",
};

const errorMessages: Record<string, string> = {
  config: "ระบบยืนยันตัวตนยังไม่ได้เชื่อมกับบัญชีผู้ให้บริการ",
  invalid_input: "กรุณากรอกอีเมล",
  expired: "ลิงก์หมดอายุหรือไม่ถูกต้อง กรุณาขอลิงก์ใหม่",
};

type ForgotPasswordPageProps = {
  searchParams: Promise<{ error?: string; sent?: string }>;
};

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const params = await searchParams;
  const configured = isSupabaseConfigured();
  const error = params.error ? errorMessages[params.error] : null;

  return (
    <main className="login-page">
      <div className="aurora" aria-hidden="true">
        <i className="aurora-one" />
        <i className="aurora-two" />
      </div>
      <section className="login-card" aria-labelledby="forgot-title">
        <Link className="brand" href="/">
          <span className="brand-mark">NG</span>
          <span className="brand-name">
            NATHEE GROUP<small>LOGISTICS SYSTEM</small>
          </span>
        </Link>
        <h1 id="forgot-title">ลืมรหัสผ่าน</h1>
        <p className="login-subtitle">
          กรอกอีเมลที่ได้รับสิทธิ์ ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่
        </p>

        {error && <div className="form-message error" role="alert">{error}</div>}
        {params.sent === "1" && (
          <div className="form-message success" role="status">
            หากอีเมลนี้มีบัญชีอยู่ ระบบได้ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว
          </div>
        )}

        <form action="/api/auth/forgot-password" method="post">
          <div className="field">
            <label htmlFor="email">อีเมล</label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@company.com"
              required
              disabled={!configured}
            />
          </div>
          <button
            className="button button-gradient login-submit"
            type="submit"
            disabled={!configured}
          >
            ส่งลิงก์ตั้งรหัสผ่านใหม่
          </button>
        </form>
        <div className="auth-links single">
          <Link href="/login">← กลับหน้าเข้าสู่ระบบ</Link>
        </div>
      </section>
    </main>
  );
}
