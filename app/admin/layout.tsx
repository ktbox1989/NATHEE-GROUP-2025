import type { Metadata } from "next";
import type { ReactNode } from "react";
import { can } from "@/lib/authorization";
import { requireAdminActor } from "@/lib/admin-access";
import { roleLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "NATHEE Operations",
  robots: { index: false, follow: false },
};

type NavItem = {
  href: string;
  label: string;
  icon: string;
};

function NavLinks({ items }: { items: NavItem[] }) {
  return (
    <>
      {items.map((item) => (
        <a className="admin-nav-link" href={item.href} key={item.href}>
          <span aria-hidden="true">{item.icon}</span>
          <b>{item.label}</b>
        </a>
      ))}
    </>
  );
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await requireAdminActor("/admin");

  const quickItems: NavItem[] = [{ href: "/admin", label: "ภาพรวม", icon: "◫" }];
  if (can(actor, "jobs:read")) {
    quickItems.push({ href: "/admin/jobs", label: "งานขนส่ง", icon: "▣" });
  }
  if (can(actor, "site:read")) {
    quickItems.push({ href: "/admin/posts", label: "ข่าวและบทความ", icon: "◩" });
  }

  const systemItems: NavItem[] = [];
  if (can(actor, "companies:read")) {
    systemItems.push({ href: "/app/companies", label: "บริษัทลูกค้า", icon: "⌂" });
  }
  if (can(actor, "motorcycles:read")) {
    systemItems.push({ href: "/app/motorcycles", label: "รถจักรยานยนต์", icon: "◆" });
    systemItems.push({ href: "/app/scan", label: "สแกน QR", icon: "⌗" });
  }
  if (can(actor, "jobs:read")) {
    systemItems.push({ href: "/app/trips", label: "เที่ยววิ่ง", icon: "↗" });
    systemItems.push({ href: "/app/containers", label: "ตู้คอนเทนเนอร์", icon: "▤" });
  }
  if (can(actor, "yard:read")) {
    systemItems.push({ href: "/app/yard", label: "จัดการลาน", icon: "▦" });
  }
  if (can(actor, "documents:read")) {
    systemItems.push({ href: "/app/print-center", label: "ศูนย์พิมพ์", icon: "▧" });
  }
  if (can(actor, "gallery:read")) {
    systemItems.push({ href: "/app/gallery", label: "Gallery / Portfolio", icon: "▥" });
  }
  if (can(actor, "site:read")) {
    systemItems.push({ href: "/app/website", label: "จัดการเว็บไซต์", icon: "✦" });
    systemItems.push({ href: "/app/site-content", label: "หน้าเว็บไซต์", icon: "▰" });
    systemItems.push({ href: "/app/site-settings", label: "ตั้งค่าเว็บไซต์", icon: "⚙" });
  }
  if (can(actor, "jobs:read") || can(actor, "motorcycles:read")) {
    systemItems.push({ href: "/app/reports", label: "รายงาน", icon: "▥" });
  }
  if (actor.role === "OWNER") {
    systemItems.push({ href: "/app/quotations", label: "คำขอใบเสนอราคา", icon: "▱" });
    systemItems.push({ href: "/app/users", label: "สมาชิก / สิทธิ์", icon: "◎" });
  }
  if (can(actor, "audit:read")) {
    systemItems.push({ href: "/app/audit", label: "Audit Log", icon: "⌕" });
  }

  return (
    <main className="app-shell admin-shell">
      <header className="admin-topbar">
        <div className="admin-topbar-inner">
          <a className="admin-brand" href="/admin" aria-label="NATHEE Operations หน้าหลัก">
            <span className="admin-brand-mark" aria-hidden="true">N</span>
            <span className="admin-brand-copy">
              <b>NATHEE</b>
              <small>Operations Center</small>
            </span>
          </a>
          <span className={`admin-role-badge ${actor.role}`}>{roleLabels[actor.role]}</span>
          <span className="admin-topbar-spacer" />
          <a className="admin-site-link" href="https://natheegroup2025.com/" target="_blank" rel="noreferrer">
            ดูเว็บไซต์
          </a>
          <span className="admin-user">
            <b>{actor.displayName}</b>
            <small>{actor.email}</small>
          </span>
          <form action="/api/auth/logout" method="post">
            <button className="admin-logout" type="submit">ออกจากระบบ</button>
          </form>
        </div>
      </header>

      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-sidebar-intro">
            <span>ศูนย์ปฏิบัติการ</span>
            <b>งานจริง ข้อมูลจริง</b>
            <small>เมนูที่เห็นอิงตามสิทธิ์ของบัญชีที่ล็อกอิน</small>
          </div>
          <nav className="admin-nav" aria-label="เมนูหลังบ้าน NATHEE">
            <p className="admin-nav-label">จัดการด่วน</p>
            <NavLinks items={quickItems} />
            {systemItems.length > 0 && (
              <>
                <p className="admin-nav-label admin-nav-label-spaced">ระบบทั้งหมด</p>
                <NavLinks items={systemItems} />
              </>
            )}
          </nav>
          <div className="admin-sidebar-foot">
            <span aria-hidden="true">✓</span>
            <p>
              <b>Server enforced</b>
              <small>ทุกการบันทึกตรวจสิทธิ์ซ้ำที่เซิร์ฟเวอร์</small>
            </p>
          </div>
        </aside>

        <section className="admin-content">{children}</section>
      </div>
    </main>
  );
}
