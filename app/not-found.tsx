import Link from "next/link";

export default function NotFound() {
  return (
    <main className="system-state-page">
      <section className="system-state-card">
        <span aria-hidden="true">404</span>
        <p>NOT FOUND</p>
        <h1>ไม่พบหน้าหรือรายการนี้</h1>
        <p>รายการอาจถูกย้าย ปิดใช้งาน หรือคุณไม่มีสิทธิ์เข้าถึง</p>
        <div>
          <Link className="button button-gradient" href="/app">กลับหน้าหลัก</Link>
          <Link className="button button-glass" href="/">เว็บไซต์บริษัท</Link>
        </div>
      </section>
    </main>
  );
}
