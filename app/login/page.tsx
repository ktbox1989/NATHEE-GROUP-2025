import Link from "next/link";
import type { Metadata } from "next";
import { isOwnerPinConfigured } from "@/lib/owner-pin";
import {
  OWNER_LOGIN_EMAIL,
  OWNER_PIN_LENGTH,
  OWNER_PIN_PATTERN,
  isPinFieldRefusal,
  ownerLoginReturnTo,
  ownerPinLoginError,
  ownerPinLoginStatus,
} from "@/lib/owner-pin-login";

export const metadata: Metadata = {
  title: "เข้าสู่ระบบเจ้าของ | NATHEE GROUP 2025",
  description: "เข้าสู่ระบบจัดการเว็บไซต์ NATHEE GROUP 2025 ด้วย PIN ของเจ้าของ",
  // A sign-in screen has nothing to offer a search result, and an indexed one
  // invites traffic that can only ever be refused. The static release's
  // /login/ page is noindex for the same reason.
  robots: { index: false, follow: false },
};

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    status?: string;
    returnTo?: string;
    retryAfter?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const error = ownerPinLoginError(params.error, params.retryAfter);
  const status = ownerPinLoginStatus(params.status);
  const returnTo = ownerLoginReturnTo(params.returnTo);
  // The two refusals that are about what was typed, so the field itself can say
  // so rather than only a paragraph above it. They are the route's own codes:
  // a PIN of the wrong shape, and a PIN of the right shape that was wrong.
  const pinRejected = isPinFieldRefusal(params.error);
  // Said before the attempt rather than after it. The form still posts — the
  // server is the authority on its own configuration, and it answers
  // `?error=config` — but an Owner who has not set the secrets yet should not
  // have to spend a PIN entry to be told so. This is not a gate: nothing on
  // this screen is disabled, because the check is about the server's state and
  // the person at the keyboard may well be the one about to fix it.
  const ownerPinReady = isOwnerPinConfigured();

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
        <h1 id="login-title">เข้าสู่ระบบเจ้าของ</h1>
        <p className="login-subtitle">
          สำหรับจัดการเว็บไซต์และเนื้อหาของ NATHEE GROUP 2025
        </p>

        {/* The identity is shown, never asked for. The server fixes it; an
            address carried from here would be the browser claiming who it is. */}
        <div className="owner-identity">
          <span className="owner-identity-label">บัญชีเจ้าของ</span>
          <strong className="owner-identity-value">{OWNER_LOGIN_EMAIL}</strong>
          <span className="owner-identity-note">
            ระบบกำหนดบัญชีนี้ไว้แล้ว แก้ไขจากหน้านี้ไม่ได้ และหน้านี้ไม่ได้ส่งอีเมลไปกับการเข้าสู่ระบบ
          </span>
        </div>

        {!ownerPinReady && (
          <div className="login-notice" role="status">
            เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า PIN ของเจ้าของ จึงยังเข้าสู่ระบบด้วย PIN ไม่ได้
            ต้องตั้งค่าที่ระบบเก็บความลับของเซิร์ฟเวอร์ก่อน ไม่ใช่ที่หน้านี้
          </div>
        )}
        {error && <div className="form-message error" role="alert">{error}</div>}
        {status && <div className="form-message success" role="status">{status}</div>}

        {/* The target stays a literal path: the response-header gate reads form
            targets straight out of the source to prove form-action 'self' is
            not being broken, and a target behind a constant is invisible to it. */}
        <form action="/api/auth/owner-pin/login" method="post">
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="field">
            <label htmlFor="pin">PIN ของเจ้าของ</label>
            <input
              id="pin"
              className="owner-pin-input"
              name="pin"
              type="password"
              inputMode="numeric"
              pattern={OWNER_PIN_PATTERN}
              maxLength={OWNER_PIN_LENGTH}
              minLength={OWNER_PIN_LENGTH}
              autoComplete="current-password"
              spellCheck={false}
              aria-describedby="pin-hint"
              aria-invalid={pinRejected || undefined}
              required
            />
            <p className="field-hint" id="pin-hint">
              ตัวเลข 0-9 จำนวน {OWNER_PIN_LENGTH} หลัก · ระบบไม่แสดง PIN ที่พิมพ์ และไม่เก็บไว้ในหน้านี้
            </p>
          </div>
          <button className="button button-gradient login-submit" type="submit">
            เข้าสู่ระบบ
          </button>
        </form>

        <p className="login-footnote">
          ลืม PIN? PIN ถูกเก็บไว้ที่เซิร์ฟเวอร์ ตั้งใหม่ได้ที่เซิร์ฟเวอร์เท่านั้น
          หน้านี้ขอ PIN ใหม่หรือส่ง PIN ทางอีเมลไม่ได้
        </p>
        <div className="auth-links single">
          <Link href="/">← กลับหน้าแรก</Link>
        </div>
      </section>
    </main>
  );
}
