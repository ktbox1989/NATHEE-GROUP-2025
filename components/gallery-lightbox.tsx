"use client";

/* eslint-disable @next/next/no-img-element -- images are content-negotiated by the authenticated/public R2 route */

import { useEffect, useState } from "react";

export type PublicGalleryItem = { id: string; title: string; caption: string | null; altText: string; categoryName: string; takenAt: string | null; location: string | null };

export function GalleryLightbox({ items }: { items: PublicGalleryItem[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (selected === null) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key === "ArrowRight") setSelected((selected + 1) % items.length);
      if (event.key === "ArrowLeft") setSelected((selected - 1 + items.length) % items.length);
      if (event.key === "Tab") {
        const controls = Array.from(document.querySelectorAll<HTMLElement>(".gallery-lightbox button"));
        if (!controls.length) return;
        const current = controls.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? (current <= 0 ? controls.length - 1 : current - 1) : (current + 1) % controls.length;
        event.preventDefault(); controls[next].focus();
      }
    };
    document.body.classList.add("lightbox-open"); document.addEventListener("keydown", handler);
    document.querySelector<HTMLElement>(".gallery-lightbox-close")?.focus();
    return () => { document.body.classList.remove("lightbox-open"); document.removeEventListener("keydown", handler); };
  }, [items.length, selected]);
  const active = selected === null ? null : items[selected];
  return <>
    <div className="public-gallery-grid">{items.map((item, index) => <figure key={item.id}>
      <button type="button" onClick={(event) => { setOpener(event.currentTarget); setSelected(index); }} aria-label={`เปิดภาพขนาดใหญ่: ${item.altText}`}><img src={`/api/gallery/images/${item.id}?role=thumbnail`} alt={item.altText} loading="lazy" decoding="async" /></button>
      <figcaption><span>{item.categoryName}</span><h2>{item.title}</h2>{(item.takenAt || item.location) && <small>{[item.takenAt, item.location].filter(Boolean).join(" · ")}</small>}{item.caption && <p>{item.caption}</p>}</figcaption>
    </figure>)}</div>
    {active && <div className="gallery-lightbox" role="dialog" aria-modal="true" aria-label={active.title}>
      <button className="gallery-lightbox-close" type="button" onClick={() => { setSelected(null); queueMicrotask(() => opener?.focus()); }} aria-label="ปิดภาพ">×</button>
      <button className="gallery-lightbox-prev" type="button" onClick={() => setSelected((selected! - 1 + items.length) % items.length)} aria-label="ภาพก่อนหน้า">‹</button>
      <figure><img src={`/api/gallery/images/${active.id}?role=display`} alt={active.altText} /><figcaption><span>{active.categoryName}</span><h2>{active.title}</h2>{(active.takenAt || active.location) && <small>{[active.takenAt, active.location].filter(Boolean).join(" · ")}</small>}{active.caption && <p>{active.caption}</p>}</figcaption></figure>
      <button className="gallery-lightbox-next" type="button" onClick={() => setSelected((selected! + 1) % items.length)} aria-label="ภาพถัดไป">›</button>
    </div>}
  </>;
}
