"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";

export type AppNavItem = {
  href: string;
  label: string;
  icon: string;
};

export function AppNav({ items }: { items: AppNavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <nav className="app-sidebar" aria-label="เมนูระบบ">
      <div className="app-side-head"><div className="app-side-label">เมนูหลัก</div><button className="app-nav-toggle" type="button" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((value) => !value)}><span>{open ? "ปิดเมนู" : "เปิดเมนู"}</span><i aria-hidden="true" /></button></div>
      <div className={`app-side-links${open ? " is-open" : ""}`} id={menuId}>{items.map((item) => {
        const active =
          item.href === "/app"
            ? pathname === item.href
            : pathname.startsWith(item.href);
        return (
          <Link
            className={`app-side-item${active ? " active" : ""}`}
            href={item.href}
            key={item.href}
            onClick={() => setOpen(false)}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}</div>
    </nav>
  );
}
