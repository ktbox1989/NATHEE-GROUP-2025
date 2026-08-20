"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type AppNavItem = {
  href: string;
  label: string;
  icon: string;
};

export function AppNav({ items }: { items: AppNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="app-sidebar" aria-label="เมนูระบบ">
      <div className="app-side-label">เมนูหลัก</div>
      {items.map((item) => {
        const active =
          item.href === "/app"
            ? pathname === item.href
            : pathname.startsWith(item.href);
        return (
          <Link
            className={`app-side-item${active ? " active" : ""}`}
            href={item.href}
            key={item.href}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
