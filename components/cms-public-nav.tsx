"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

export type CmsPublicNavItem = {
  href: string;
  label: string;
  active: boolean;
};

export function CmsPublicNav({ items, loginLabel }: { items: CmsPublicNavItem[]; loginLabel: string }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return <>
    <button
      type="button"
      className="cms-nav-toggle"
      aria-expanded={open}
      aria-controls={menuId}
      onClick={() => setOpen((value) => !value)}
    >
      <span className="sr-only">{open ? "ปิดเมนู" : "เปิดเมนู"}</span>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </button>
    <nav className={open ? "is-open" : ""} id={menuId} aria-label="เมนูหลัก">
      {items.map((item) => <Link className={item.active ? "active" : ""} href={item.href} key={item.href} onClick={() => setOpen(false)}>{item.label}</Link>)}
      <Link className="button button-small button-gradient" href="/login" onClick={() => setOpen(false)}>{loginLabel}</Link>
    </nav>
  </>;
}
