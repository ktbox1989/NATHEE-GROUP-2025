import Link from "next/link";
import { and, count, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppNav, type AppNavItem } from "@/components/app-nav";
import { getDb } from "@/db";
import { notifications } from "@/db/schema";
import { can, isCustomerRole, isInternalRole } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { roleLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "NATHEE SYSTEM",
  robots: { index: false, follow: false },
};

export default async function OperationsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const actor = await requireActor("/app");
  const policyCompany = isCustomerRole(actor.role) ? actor.companyId : undefined;
  const items: AppNavItem[] = [{ href: "/app", label: "Dashboard", icon: "📊" }];
  const unreadRow = await getDb()
    .select({ total: count() })
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, actor.userId), isNull(notifications.readAt)))
    .get();
  const unreadCount = Number(unreadRow?.total ?? 0);
  items.push({ href: "/app/notifications", label: `การแจ้งเตือน${unreadCount ? ` (${Math.min(unreadCount, 99)}${unreadCount > 99 ? "+" : ""})` : ""}`, icon: "🔔" });

  if (can(actor, "companies:read", policyCompany)) {
    items.push({ href: "/app/companies", label: "บริษัทลูกค้า", icon: "🏢" });
  }
  if (can(actor, "jobs:read", policyCompany)) {
    items.push({ href: "/app/jobs", label: "งานขนส่ง", icon: "📦" });
    if (isInternalRole(actor.role)) items.push({ href: "/app/trips", label: "เที่ยววิ่ง / รถขนส่ง", icon: "🚚" });
    if (isInternalRole(actor.role)) items.push({ href: "/app/containers", label: "ตู้คอนเทนเนอร์", icon: "🚢" });
  }
  if (can(actor, "motorcycles:read", policyCompany)) {
    items.push({ href: "/app/motorcycles", label: "รถจักรยานยนต์", icon: "🏍️" });
    items.push({ href: "/app/scan", label: "สแกน QR", icon: "⌗" });
  }
  if (can(actor, "yard:read")) {
    items.push({ href: "/app/yard", label: "จัดการลาน", icon: "🅿️" });
  }
  if (can(actor, "gallery:read")) {
    items.push({ href: "/app/gallery", label: "Gallery / Portfolio", icon: "🖼️" });
  }
  if (actor.role === "OWNER") {
    items.push({ href: "/app/users", label: "สมาชิก / สิทธิ์", icon: "👥" });
  }
  if (can(actor, "audit:read")) {
    items.push({ href: "/app/audit", label: "Audit Log", icon: "🔍" });
  }

  return (
    <main className="app-shell">
      <header className="app-top">
        <div className="app-top-inner">
          <Link className="app-brand" href="/app">
            <span className="brand-mark">NG</span>
            <b>NATHEE SYSTEM</b>
          </Link>
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
        <AppNav items={items} />
        <div className="app-main">{children}</div>
      </div>
    </main>
  );
}
