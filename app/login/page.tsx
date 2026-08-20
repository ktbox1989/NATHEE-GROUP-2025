import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata = {
  title: "เข้าสู่ระบบ | NATHEE GROUP 2025",
  description: "เข้าสู่ระบบสำหรับเจ้าของ พนักงาน และลูกค้าบริษัท",
};

const errorMessages: Record<string, string> = {
  config: "ระบบยืนยันตัวตนยังไม่ได้เชื่อมกับบัญชีผู้ให้บริการ",
  invalid_input: "กรุณากรอกอีเมลและรหัสผ่านให้ครบ",
  invalid_credentials: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  not_authorized: "บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าใช้งานระบบ NATHEE",
};

const statusMessages: Record<string, string> = {
  password_updated: "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว กรุณาเข้าสู่ระบบอีกครั้ง",
  logged_out: "ออกจากระบบเรียบร้อยแล้ว",
};

type LoginPageProps = {
  searchParams: Promise<{ error?: string; status?: string; returnTo?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const configured = isSupabaseConfigured();
  const error = params.error ? errorMessages[params.error] : null;
  const status = params.status ? statusMessages[params.status] : null;
  const returnTo =
    params.returnTo?.startsWith("/") && !params.returnTo.startsWith("//")
      ? params.returnTo
      : "/app";

  return (
    <main className="login-page">
      <div className="aurora" aria-hidden="true">
        <i className="aurora-one" />
        <i className="aurora-two" />
      </div>
      <section className="login-card" aria-labelledby="login-title">
        <Link className="brand" href="/">
          <span className="brand-mark">NG</span>
          <span className="brand-name">
            NATHEE GROUP<small>LOGISTICS SYSTEM</small>
          </span>
        </Link>
        <h1 id="login-title">เข้าสู่ระบบ</h1>
        <p className="login-subtitle">
          สำหรับเจ้าของ พนักงาน และลูกค้าบริษัท
        </p>

        {!configured && (
          <div className="login-notice" role="status">
            UI พร้อมใช้งานแล้ว เหลือเชื่อม Project URL และ Publishable Key
            ของระบบยืนยันตัวตนก่อนเปิดรับบัญชีจริง
          </div>
        )}
        {error && <div className="form-message error" role="alert">{error}</div>}
        {status && <div className="form-message success" role="status">{status}</div>}

        <form action="/api/auth/login" method="post">
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="field">
            <label htmlFor="email">อีเมล</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              placeholder="name@company.com"
              required
              disabled={!configured}
            />
          </div>
          <div className="field">
            <label htmlFor="password">รหัสผ่าน</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              required
              disabled={!configured}
            />
          </div>
          <button
            className="button button-gradient login-submit"
            type="submit"
            disabled={!configured}
          >
            เข้าสู่ระบบ
          </button>
        </form>

        <div className="auth-links">
          <Link href="/forgot-password">ลืมรหัสผ่าน?</Link>
          <Link href="/">← กลับหน้าแรก</Link>
        </div>
      </section>
    </main>
  );
}
