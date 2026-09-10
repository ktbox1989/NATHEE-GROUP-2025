import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireActor } from "@/lib/current-actor";
import { roleLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "NATHEE หลังบ้าน (แบบฟอร์มธรรมดา)",
  robots: { index: false, follow: false },
};

/**
 * The plain-form back office.
 *
 * Every page under /admin is a server component and every control is a native
 * HTML form. Nothing depends on client script: no router interception, no
 * hydration, no busy state. Pages navigate with ordinary links, so this side of
 * the system keeps working in any browser condition that can submit a form at
 * all. The full back office at /app stays available for everything this
 * compact surface does not cover.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor("/admin");

  return (
    <main className="app-shell">
      <header className="app-top">
        <div className="app-top-inner">
          { }
          <a className="app-brand" href="/admin">
            <span className="brand-mark">NG</span>
            <b>หลังบ้าน NATHEE</b>
          </a>
          <span className={`app-role ${actor.role}`}>{roleLabels[actor.role]}</span>
          <span className="app-spacer" />
          <span className="app-who">
            <b>{actor.displayName}</b>
            <small>{actor.email}</small>
          </span>
          <form action="/api/auth/logout" method="post">
            <button className="app-logout" type="submit">ออกจากระบบ</button>
          </form>
        </div>
      </header>
      <div className="app-body">
        <nav className="app-nav" aria-label="เมนูหลังบ้าน">
          <p>เมนูหลัก</p>
          { }
          <a href="/admin">🏠 หน้าหลัก</a>
          <a href="/admin/jobs">📦 งานขนส่ง</a>
          <a href="/admin/posts">📰 ข่าวและบทความ</a>
          <a href="/app">⚙ หลังบ้านเต็มรูปแบบ</a>
        </nav>
        <div className="app-main">{children}</div>
      </div>
    </main>
  );
}
