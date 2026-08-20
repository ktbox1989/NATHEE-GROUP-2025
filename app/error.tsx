"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application route failed", error.digest ?? error.name);
  }, [error]);

  return (
    <main className="system-state-page">
      <section className="system-state-card" role="alert">
        <span aria-hidden="true">⚠️</span>
        <p>SYSTEM ERROR</p>
        <h1>เปิดหน้านี้ไม่สำเร็จ</h1>
        <p>ข้อมูลของคุณยังไม่ถูกลบ กรุณาลองเชื่อมต่อใหม่อีกครั้ง</p>
        <div>
          <button className="button button-gradient" type="button" onClick={reset}>
            ลองอีกครั้ง
          </button>
          <Link className="button button-glass" href="/app">
            กลับหน้าหลัก
          </Link>
        </div>
      </section>
    </main>
  );
}
