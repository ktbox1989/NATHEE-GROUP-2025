import Link from "next/link";
import type { ReactNode } from "react";
import { AppNav, type AppNavItem } from "@/components/app-nav";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { roleLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function OperationsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const actor = await requireActor("/app");
  const policyCompany = actor.role === "CUSTOMER" ? actor.companyId : undefined;
  const items: AppNavItem[] = [{ href: "/app", label: "Dashboard", icon: "📊" }];

  if (can(actor, "companies:read", policyCompany)) {
    items.push({ href: "/app/companies", label: "บริษัทลูกค้า", icon: "🏢" });
  }
  if (can(actor, "jobs:read", policyCompany)) {
    items.push({ href: "/app/jobs", label: "งานขนส่ง", icon: "📦" });
  }
  if (can(actor, "motorcycles:read", policyCompany)) {
    items.push({ href: "/app/motorcycles", label: "รถจักรยานยนต์", icon: "🏍️" });
  }
  if (actor.role === "OWNER") {
    items.push({ href: "/app/users", label: "สมาชิก / สิทธิ์", icon: "👥" });
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
