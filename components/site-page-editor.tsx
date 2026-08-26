"use client";

import { useRef, useState, type FormEvent } from "react";
import { browserSecureId } from "@/lib/browser-secure-id";
// From the content module: `@/lib/site-cms` resolves the D1 binding, and a
// value imported from it pulls `cloudflare:workers` into the client bundle.
import { CMS_ROBOTS, parseCmsPageContent, type CmsFeature, type CmsPageContent, type CmsRobots, type CmsSection, type CmsSectionType } from "@/lib/site-cms-content";

type MediaOption = { id: string; label: string };
type CategoryOption = { slug: string; label: string };
const types: { value: CmsSectionType; label: string }[] = [
  { value: "HERO", label: "Hero / หัวหน้าเว็บ" }, { value: "CONTENT", label: "เนื้อหา" },
  { value: "FEATURES", label: "รายการจุดเด่น" }, { value: "GALLERY", label: "Gallery" },
  { value: "FAQ", label: "คำถามที่พบบ่อย / FAQ" }, { value: "CTA", label: "ปุ่มเรียกให้ติดต่อ" }, { value: "CONTACT", label: "ข้อมูลติดต่อ" },
];

export function SitePageEditor({ slug, initial, media, categories }: { slug: string; initial: CmsPageContent; media: MediaOption[]; categories: CategoryOption[] }) {
  const [content, setContent] = useState(initial);
  // The publish route refuses NOINDEX for home, so the control never offers it
  // rather than letting the Owner pick something that is rejected later.
  const isHome = slug === "home";
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const payloadRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    const validated = parseCmsPageContent(content);
    if (!validated) {
      event.preventDefault();
      return setMessage("ยังบันทึกไม่ได้ กรุณาตรวจชื่อ คำอธิบาย ลิงก์ และรายการของทุก Section");
    }
    try {
      if (payloadRef.current) payloadRef.current.value = JSON.stringify(validated);
      if (requestRef.current) requestRef.current.value = browserSecureId("cms-save");
      setBusy(true);
      setMessage("กำลังบันทึก Revision ใหม่…");
    } catch {
      event.preventDefault(); setBusy(false); setMessage("เบราว์เซอร์นี้สร้างรหัสคำขอที่ปลอดภัยไม่ได้ กรุณาใช้ Chrome, Edge หรือ Safari รุ่นใหม่");
    }
  }

  function patchSection(index: number, patch: Partial<CmsSection>) {
    setContent((current) => ({ ...current, sections: current.sections.map((section, itemIndex) => itemIndex === index ? { ...section, ...patch } : section) }));
  }

  function patchItem(sectionIndex: number, itemIndex: number, patch: Partial<CmsFeature>) {
    setContent((current) => ({
      ...current,
      sections: current.sections.map((section, position) => position === sectionIndex
        ? { ...section, items: section.items.map((item, index) => index === itemIndex ? { ...item, ...patch } : item) }
        : section),
    }));
  }

  function moveItem(sectionIndex: number, itemIndex: number, direction: -1 | 1) {
    const target = itemIndex + direction;
    const items = content.sections[sectionIndex]?.items ?? [];
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[itemIndex], next[target]] = [next[target], next[itemIndex]];
    patchSection(sectionIndex, { items: next });
  }

  function addService(sectionIndex: number) {
    const section = content.sections[sectionIndex];
    if (!section || section.items.length >= 12) return;
    patchSection(sectionIndex, { items: [...section.items, { title: "บริการใหม่", body: "รายละเอียดบริการ" }] });
  }

  function removeService(sectionIndex: number, itemIndex: number) {
    const section = content.sections[sectionIndex];
    if (!section || section.items.length <= 1 || !window.confirm("นำบริการนี้ออกจาก Draft ใหม่ใช่หรือไม่? ฉบับที่เผยแพร่อยู่จะยังไม่เปลี่ยน")) return;
    patchSection(sectionIndex, { items: section.items.filter((_, index) => index !== itemIndex) });
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

  return <form className="site-editor" action={`/api/site-content/${encodeURIComponent(slug)}/revisions`} method="post" onSubmit={submit} aria-busy={busy}>
    <input ref={requestRef} type="hidden" name="requestKey" />
    <input ref={payloadRef} type="hidden" name="contentJson" />
    <section className="app-panel site-editor-seo"><div><p>SEO</p><h2>ชื่อและคำอธิบายในผลค้นหา</h2></div><label>Page title<input value={content.seo.title} maxLength={120} required onChange={(event) => setContent((current) => ({ ...current, seo: { ...current.seo, title: event.target.value } }))} /></label><label>Meta description<textarea value={content.seo.description} minLength={20} maxLength={300} required rows={3} onChange={(event) => setContent((current) => ({ ...current, seo: { ...current.seo, description: event.target.value } }))} /></label>
      <label>การจัดทำดัชนี
        <select
          value={content.seo.robots}
          disabled={isHome}
          onChange={(event) => setContent((current) => ({ ...current, seo: { ...current.seo, robots: event.target.value as CmsRobots } }))}
        >
          {CMS_ROBOTS.filter((value) => !isHome || value === "INDEX").map((value) => (
            <option key={value} value={value}>
              {value === "INDEX" ? "INDEX — ให้ค้นหาเจอ" : "NOINDEX — เผยแพร่แต่ไม่ให้ค้นหาเจอ"}
            </option>
          ))}
        </select>
        <small>
          {isHome
            ? "หน้าแรกตั้งเป็น NOINDEX ไม่ได้ เพราะทุกหน้าลิงก์กลับมาที่หน้าแรก ระบบจะปฏิเสธตอนเผยแพร่"
            : "NOINDEX คือเผยแพร่ให้เปิดดูได้ แต่ไม่ขอให้ค้นหาเจอ · หน้าตัวอย่าง (Preview) เป็น noindex เสมออยู่แล้วไม่ว่าจะตั้งค่าใด"}
        </small>
      </label></section>
    <div className="site-editor-list">{content.sections.map((section, index) => <section className="app-panel site-editor-section" key={section.id}><header><div><span>SECTION {index + 1}</span><h2>{section.heading || "ยังไม่มีหัวข้อ"}</h2></div><div className="site-editor-order"><button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="เลื่อน Section ขึ้น">↑</button><button type="button" onClick={() => move(index, 1)} disabled={index === content.sections.length - 1} aria-label="เลื่อน Section ลง">↓</button><button type="button" onClick={() => remove(index)} disabled={content.sections.length === 1}>นำออก</button></div></header><div className="record-form">
      <label className="field">ประเภท<select value={section.type} onChange={(event) => patchSection(index, { type: event.target.value as CmsSectionType })}>{types.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}</select></label>
      <label className="field site-editor-toggle"><input type="checkbox" checked={section.enabled} onChange={(event) => patchSection(index, { enabled: event.target.checked })} /> แสดง Section นี้</label>
      <label className="field">ข้อความนำ<input value={section.eyebrow} maxLength={100} onChange={(event) => patchSection(index, { eyebrow: event.target.value })} /></label>
      <label className="field">หัวข้อ *<input value={section.heading} maxLength={180} required onChange={(event) => patchSection(index, { heading: event.target.value })} /></label>
      <label className="field full">เนื้อหา<textarea value={section.body} maxLength={2000} rows={4} onChange={(event) => patchSection(index, { body: event.target.value })} /></label>
      <label className="field">ภาพประกอบ<select value={section.imageItemId} onChange={(event) => patchSection(index, { imageItemId: event.target.value })}><option value="">ไม่ใช้ภาพ</option>{media.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      {section.type === "GALLERY" && <><label className="field">หมวด Gallery<select value={section.galleryCategorySlug} onChange={(event) => patchSection(index, { galleryCategorySlug: event.target.value })}><option value="">ทุกหมวด</option>{categories.map((item) => <option value={item.slug} key={item.slug}>{item.label}</option>)}</select></label><label className="field">จำนวนภาพ<input type="number" min={1} max={24} value={section.galleryLimit} onChange={(event) => patchSection(index, { galleryLimit: Number(event.target.value) })} /></label></>}
      {slug === "services" && section.id === "services-list" ? (
        <fieldset className="field full cms-service-items">
          <legend>รายการบริการ</legend>
          <p>แต่ละรายการจะยังเป็น Draft จนกว่าจะบันทึก Revision และกดเผยแพร่</p>
          {section.items.map((item, itemIndex) => (
            <details className="cms-service-item" key={`${item.title}-${itemIndex}`}>
              <summary>แก้ไขบริการ: {item.title || `รายการ ${itemIndex + 1}`}</summary>
              <div className="record-form">
                <label className="field">ชื่อบริการ *<input required maxLength={160} value={item.title} onChange={(event) => patchItem(index, itemIndex, { title: event.target.value })} /></label>
                <label className="field full">รายละเอียด *<textarea required maxLength={500} rows={3} value={item.body} onChange={(event) => patchItem(index, itemIndex, { body: event.target.value })} /></label>
                <div className="site-editor-order full">
                  <button type="button" disabled={busy || itemIndex === 0} onClick={() => moveItem(index, itemIndex, -1)} aria-label={`เลื่อน ${item.title} ขึ้น`}>↑ ขึ้น</button>
                  <button type="button" disabled={busy || itemIndex === section.items.length - 1} onClick={() => moveItem(index, itemIndex, 1)} aria-label={`เลื่อน ${item.title} ลง`}>↓ ลง</button>
                  <button type="button" disabled={busy || section.items.length === 1} onClick={() => removeService(index, itemIndex)}>นำบริการออก</button>
                </div>
              </div>
            </details>
          ))}
          {section.items.length < 12 && <button className="button button-glass" type="button" disabled={busy} onClick={() => addService(index)}>+ เพิ่มบริการ</button>}
        </fieldset>
      ) : (section.type === "FEATURES" || section.type === "CONTACT" || section.type === "FAQ") && <label className="field full">รายการ — หนึ่งบรรทัดต่อรายการ ใช้ | คั่นหัวข้อกับรายละเอียด<textarea rows={6} value={section.items.map((item) => `${item.title} | ${item.body}`).join("\n")} onChange={(event) => patchSection(index, { items: parseItems(event.target.value) })} placeholder="ขนส่งทั่วประเทศ | รองรับงานรายคันและงานล็อต" /></label>}
      <label className="field">ปุ่มหลัก — ข้อความ<input value={section.primaryLabel} maxLength={80} onChange={(event) => patchSection(index, { primaryLabel: event.target.value })} /></label><label className="field">ปุ่มหลัก — URL<input value={section.primaryHref} maxLength={300} placeholder="/contact หรือ tel:0631941191" onChange={(event) => patchSection(index, { primaryHref: event.target.value })} /></label>
      <label className="field">ปุ่มรอง — ข้อความ<input value={section.secondaryLabel} maxLength={80} onChange={(event) => patchSection(index, { secondaryLabel: event.target.value })} /></label><label className="field">ปุ่มรอง — URL<input value={section.secondaryHref} maxLength={300} placeholder="/gallery" onChange={(event) => patchSection(index, { secondaryHref: event.target.value })} /></label>
    </div></section>)}</div>
    <button className="button button-glass" type="button" onClick={addSection} disabled={busy}>+ เพิ่ม Section</button>
    <section className="app-panel site-editor-save"><label>หมายเหตุการแก้ไข<textarea name="changeNote" maxLength={500} rows={2} placeholder="เช่น เพิ่มภาพผลงานลานสต๊อกและปรับข้อความบริการ" /></label><button className="button button-gradient" type="submit" disabled={busy} aria-busy={busy}>{busy ? "กำลังบันทึก…" : "บันทึกเป็น Revision ใหม่"}</button>{message && <p role="status" aria-live="polite">{message}</p>}</section>
  </form>;
}

function parseItems(value: string) {
  return value.split("\n").slice(0, 12).map((line) => { const [title, ...rest] = line.split("|"); return { title: title.trim().slice(0, 160), body: rest.join("|").trim().slice(0, 500) }; }).filter((item) => item.title);
}
