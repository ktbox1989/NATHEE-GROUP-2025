"use client";

import { useRef, useState, type FormEvent } from "react";
import { browserSecureId } from "@/lib/browser-secure-id";
import type { CmsPageContent, CmsSection, CmsSectionType } from "@/lib/site-cms";

type MediaOption = { id: string; label: string };
type CategoryOption = { slug: string; label: string };
const types: { value: CmsSectionType; label: string }[] = [
  { value: "HERO", label: "Hero / หัวหน้าเว็บ" }, { value: "CONTENT", label: "เนื้อหา" },
  { value: "FEATURES", label: "รายการจุดเด่น" }, { value: "GALLERY", label: "Gallery" },
  { value: "CTA", label: "ปุ่มเรียกให้ติดต่อ" }, { value: "CONTACT", label: "ข้อมูลติดต่อ" },
];

export function SitePageEditor({ slug, initial, media, categories }: { slug: string; initial: CmsPageContent; media: MediaOption[]; categories: CategoryOption[] }) {
  const [content, setContent] = useState(initial);
  const [message, setMessage] = useState("");
  const payloadRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    if (!content.sections.length) { event.preventDefault(); return setMessage("ต้องมีอย่างน้อยหนึ่ง Section"); }
    try {
      if (payloadRef.current) payloadRef.current.value = JSON.stringify(content);
      if (requestRef.current) requestRef.current.value = browserSecureId("cms-save");
      setMessage("กำลังบันทึก Revision ใหม่…");
    } catch {
      event.preventDefault(); setMessage("เบราว์เซอร์นี้สร้างรหัสคำขอที่ปลอดภัยไม่ได้ กรุณาใช้ Chrome, Edge หรือ Safari รุ่นใหม่");
    }
  }

  function patchSection(index: number, patch: Partial<CmsSection>) {
    setContent((current) => ({ ...current, sections: current.sections.map((section, itemIndex) => itemIndex === index ? { ...section, ...patch } : section) }));
  }

  function addSection() {
    const next: CmsSection = { id: browserSecureId("section"), type: "CONTENT", enabled: true, eyebrow: "", heading: "Section ใหม่", body: "", imageItemId: "", primaryLabel: "", primaryHref: "", secondaryLabel: "", secondaryHref: "", galleryCategorySlug: "", galleryLimit: 12, items: [] };
    setContent((current) => ({ ...current, sections: [...current.sections, next] }));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= content.sections.length) return;
    setContent((current) => { const sections = [...current.sections]; [sections[index], sections[target]] = [sections[target], sections[index]]; return { ...current, sections }; });
  }

  function remove(index: number) {
    if (content.sections.length === 1 || !window.confirm("นำ Section นี้ออกจาก Revision ใหม่ใช่หรือไม่? Revision ที่เผยแพร่อยู่จะยังไม่เปลี่ยนจนกว่าจะกดเผยแพร่")) return;
    setContent((current) => ({ ...current, sections: current.sections.filter((_, itemIndex) => itemIndex !== index) }));
  }

  return <form className="site-editor" action={`/api/site-content/${encodeURIComponent(slug)}/revisions`} method="post" onSubmit={submit}>
    <input ref={requestRef} type="hidden" name="requestKey" />
    <input ref={payloadRef} type="hidden" name="contentJson" />
    <section className="app-panel site-editor-seo"><div><p>SEO</p><h2>ชื่อและคำอธิบายในผลค้นหา</h2></div><label>Page title<input value={content.seo.title} maxLength={120} required onChange={(event) => setContent((current) => ({ ...current, seo: { ...current.seo, title: event.target.value } }))} /></label><label>Meta description<textarea value={content.seo.description} minLength={20} maxLength={300} required rows={3} onChange={(event) => setContent((current) => ({ ...current, seo: { ...current.seo, description: event.target.value } }))} /></label></section>
    <div className="site-editor-list">{content.sections.map((section, index) => <section className="app-panel site-editor-section" key={section.id}><header><div><span>SECTION {index + 1}</span><h2>{section.heading || "ยังไม่มีหัวข้อ"}</h2></div><div className="site-editor-order"><button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="เลื่อน Section ขึ้น">↑</button><button type="button" onClick={() => move(index, 1)} disabled={index === content.sections.length - 1} aria-label="เลื่อน Section ลง">↓</button><button type="button" onClick={() => remove(index)} disabled={content.sections.length === 1}>นำออก</button></div></header><div className="record-form">
      <label className="field">ประเภท<select value={section.type} onChange={(event) => patchSection(index, { type: event.target.value as CmsSectionType })}>{types.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}</select></label>
      <label className="field site-editor-toggle"><input type="checkbox" checked={section.enabled} onChange={(event) => patchSection(index, { enabled: event.target.checked })} /> แสดง Section นี้</label>
      <label className="field">ข้อความนำ<input value={section.eyebrow} maxLength={100} onChange={(event) => patchSection(index, { eyebrow: event.target.value })} /></label>
      <label className="field">หัวข้อ *<input value={section.heading} maxLength={180} required onChange={(event) => patchSection(index, { heading: event.target.value })} /></label>
      <label className="field full">เนื้อหา<textarea value={section.body} maxLength={2000} rows={4} onChange={(event) => patchSection(index, { body: event.target.value })} /></label>
      <label className="field">ภาพประกอบ<select value={section.imageItemId} onChange={(event) => patchSection(index, { imageItemId: event.target.value })}><option value="">ไม่ใช้ภาพ</option>{media.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      {section.type === "GALLERY" && <><label className="field">หมวด Gallery<select value={section.galleryCategorySlug} onChange={(event) => patchSection(index, { galleryCategorySlug: event.target.value })}><option value="">ทุกหมวด</option>{categories.map((item) => <option value={item.slug} key={item.slug}>{item.label}</option>)}</select></label><label className="field">จำนวนภาพ<input type="number" min={1} max={24} value={section.galleryLimit} onChange={(event) => patchSection(index, { galleryLimit: Number(event.target.value) })} /></label></>}
      {(section.type === "FEATURES" || section.type === "CONTACT") && <label className="field full">รายการ — หนึ่งบรรทัดต่อรายการ ใช้ | คั่นหัวข้อกับรายละเอียด<textarea rows={6} value={section.items.map((item) => `${item.title} | ${item.body}`).join("\n")} onChange={(event) => patchSection(index, { items: parseItems(event.target.value) })} placeholder="ขนส่งทั่วประเทศ | รองรับงานรายคันและงานล็อต" /></label>}
      <label className="field">ปุ่มหลัก — ข้อความ<input value={section.primaryLabel} maxLength={80} onChange={(event) => patchSection(index, { primaryLabel: event.target.value })} /></label><label className="field">ปุ่มหลัก — URL<input value={section.primaryHref} maxLength={300} placeholder="/contact หรือ tel:0631941191" onChange={(event) => patchSection(index, { primaryHref: event.target.value })} /></label>
      <label className="field">ปุ่มรอง — ข้อความ<input value={section.secondaryLabel} maxLength={80} onChange={(event) => patchSection(index, { secondaryLabel: event.target.value })} /></label><label className="field">ปุ่มรอง — URL<input value={section.secondaryHref} maxLength={300} placeholder="/gallery" onChange={(event) => patchSection(index, { secondaryHref: event.target.value })} /></label>
    </div></section>)}</div>
    <button className="button button-glass" type="button" onClick={addSection}>+ เพิ่ม Section</button>
    <section className="app-panel site-editor-save"><label>หมายเหตุการแก้ไข<textarea name="changeNote" maxLength={500} rows={2} placeholder="เช่น เพิ่มภาพผลงานลานสต๊อกและปรับข้อความบริการ" /></label><button className="button button-gradient" type="submit">บันทึกเป็น Revision ใหม่</button>{message && <p role="status" aria-live="polite">{message}</p>}</section>
  </form>;
}

function parseItems(value: string) {
  return value.split("\n").slice(0, 12).map((line) => { const [title, ...rest] = line.split("|"); return { title: title.trim().slice(0, 160), body: rest.join("|").trim().slice(0, 500) }; }).filter((item) => item.title);
}
