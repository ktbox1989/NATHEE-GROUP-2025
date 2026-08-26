"use client";
/* eslint-disable @next/next/no-img-element -- the delivery contract builds the src; next/image would rewrite it */

import { useRef, useState, type FormEvent } from "react";
import { browserSecureId } from "@/lib/browser-secure-id";
import { MediaPicker } from "@/components/media-picker";
import type { MediaPickerOption } from "@/lib/media-picker";
import { SITE_PAGE_DEFINITIONS } from "@/lib/site-cms-content";
import { MAX_ADDRESS_LINES, offendingContactField, withBlankAddressLinesRemoved } from "@/lib/settings-contact-validation";
// From the content module, not `@/lib/site-settings`: that one resolves the D1
// binding, and importing a value from it drags `cloudflare:workers` into the
// client bundle. Types are erased, values are not.
import { parseSiteSettings, type SiteNavigationItem, type SiteSettings } from "@/lib/site-settings-content";

type MediaOption = MediaPickerOption;

// Only routes this site actually serves. A menu entry pointing at a path with
// no page behind it is a 404 the Owner cannot see from the editor.
const publicNavigationPaths = [
  ...Object.values(SITE_PAGE_DEFINITIONS).map((definition) => ({ label: definition.label, href: definition.path })),
  { label: "ผลงาน", href: "/gallery" },
  { label: "ข่าวสาร", href: "/news" },
];

export function SiteSettingsEditor({ initial, media }: { initial: SiteSettings; media: MediaOption[] }) {
  const [settings, setSettings] = useState(initial);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const payloadRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    // Blank lines are dropped before the document is built, so the Owner can
    // leave a gap in the middle without it becoming a stored empty line.
    const cleaned = withBlankAddressLinesRemoved(settings);
    // The server refuses the whole document with one code, so it is checked here
    // first — with the server's own validator, not a second copy of its rules —
    // and the failing field is named instead of the save appearing to work.
    const offending = offendingContactField(cleaned);
    if (offending) {
      event.preventDefault();
      return setMessage(`ยังบันทึกไม่ได้: ${offending} ไม่ถูกต้องตามรูปแบบที่ระบบรับ กรุณาแก้แล้วบันทึกอีกครั้ง`);
    }
    if (!parseSiteSettings(cleaned)) {
      event.preventDefault();
      return setMessage("ยังบันทึกไม่ได้: การตั้งค่าไม่ผ่านการตรวจ กรุณาตรวจชื่อแบรนด์ เบอร์โทร และเมนู");
    }
    try {
      if (payloadRef.current) payloadRef.current.value = JSON.stringify(cleaned);
      if (requestRef.current) requestRef.current.value = browserSecureId("site-settings-save");
      setBusy(true);
      setMessage("กำลังบันทึก Revision ใหม่…");
    } catch {
      event.preventDefault();
      setBusy(false);
      setMessage("เบราว์เซอร์นี้สร้างรหัสคำขอที่ปลอดภัยไม่ได้ กรุณาใช้ Chrome, Edge หรือ Safari รุ่นใหม่");
    }
  }

  function patchNavigation(index: number, patch: Partial<SiteNavigationItem>) {
    setSettings((current) => ({ ...current, navigation: { ...current.navigation, items: current.navigation.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) } }));
  }

  function moveNavigation(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= settings.navigation.items.length) return;
    setSettings((current) => {
      const items = [...current.navigation.items];
      [items[index], items[target]] = [items[target], items[index]];
      return { ...current, navigation: { ...current.navigation, items } };
    });
  }

  function removeNavigation(index: number) {
    const item = settings.navigation.items[index];
    if (item.href === "/" || !window.confirm(`นำเมนู “${item.label}” ออกจาก Revision ใหม่นี้ใช่หรือไม่?`)) return;
    setSettings((current) => ({ ...current, navigation: { ...current.navigation, items: current.navigation.items.filter((_, itemIndex) => itemIndex !== index) } }));
  }

  function addNavigation() {
    const next = publicNavigationPaths.find((candidate) => !settings.navigation.items.some((item) => item.href === candidate.href));
    if (settings.navigation.items.length >= 8 || !next) return;
    setSettings((current) => ({ ...current, navigation: { ...current.navigation, items: [...current.navigation.items, next] } }));
  }

  const logoPreview = media.find((option) => option.id === settings.brand.logoItemId) ?? null;
  const previewAddress = settings.contact.addressLines.filter((line) => line.trim());
  const canAddNavigation = settings.navigation.items.length < 8 && publicNavigationPaths.some((candidate) => !settings.navigation.items.some((item) => item.href === candidate.href));

  return <form id="site-settings-editor" className="site-editor" action="/api/site-settings/revisions" method="post" onSubmit={submit} aria-busy={busy}>
    <input ref={requestRef} type="hidden" name="requestKey" />
    <input ref={payloadRef} type="hidden" name="settingsJson" />
    <section className="app-panel"><div className="detail-section-head"><div><p>BRAND</p><h2>ชื่อและโลโก้</h2></div><span>ใช้ร่วมกันทุกหน้าสาธารณะ</span></div><div className="record-form">
      <label className="field">ชื่อแบรนด์<input required maxLength={120} value={settings.brand.name} onChange={(event) => setSettings((current) => ({ ...current, brand: { ...current.brand, name: event.target.value } }))} /></label>
      <label className="field">ชื่อบริษัทตามกฎหมาย<input required maxLength={180} value={settings.brand.legalName} onChange={(event) => setSettings((current) => ({ ...current, brand: { ...current.brand, legalName: event.target.value } }))} /></label>
      <label className="field">อักษรย่อ<input required maxLength={6} pattern="[A-Za-z0-9]{1,6}" value={settings.brand.abbreviation} onChange={(event) => setSettings((current) => ({ ...current, brand: { ...current.brand, abbreviation: event.target.value } }))} /></label>
      <label className="field">คำอธิบายใต้แบรนด์<input required maxLength={120} value={settings.brand.tagline} onChange={(event) => setSettings((current) => ({ ...current, brand: { ...current.brand, tagline: event.target.value } }))} /></label>
      <MediaPicker
        id="brand-logo"
        label="โลโก้จาก Media Library"
        hint="ถ้าไม่เลือก เว็บไซต์จะใช้อักษรย่อแทน"
        value={settings.brand.logoItemId}
        media={media}
        onChange={(id) => setSettings((current) => ({ ...current, brand: { ...current.brand, logoItemId: id } }))}
      />
    </div></section>
    <section className="app-panel"><div className="detail-section-head"><div><p>CONTACT</p><h2>ข้อมูลติดต่อ</h2></div><span>เว้นว่างได้ · ช่องที่เว้นว่างจะไม่แสดงบนเว็บไซต์เลย ไม่มีข้อความตัวอย่าง</span></div><div className="record-form">
      <label className="field">เบอร์หลัก *<input required maxLength={20} pattern="\+?[0-9-]{7,20}" value={settings.contact.primaryPhone} onChange={(event) => setSettings((current) => ({ ...current, contact: { ...current.contact, primaryPhone: event.target.value } }))} /></label>
      <label className="field">เบอร์สำรอง<input maxLength={20} pattern="\+?[0-9-]{7,20}" value={settings.contact.secondaryPhone} onChange={(event) => setSettings((current) => ({ ...current, contact: { ...current.contact, secondaryPhone: event.target.value } }))} /></label>
      <label className="field">อีเมล<input type="email" maxLength={160} value={settings.contact.email} placeholder="ยังไม่ระบุ" onChange={(event) => setSettings((current) => ({ ...current, contact: { ...current.contact, email: event.target.value } }))} /><small>ปล่อยว่างไว้ได้ ถ้ายังไม่มีอีเมลที่ยืนยันแล้ว</small></label>
      <label className="field">LINE ID<input maxLength={60} value={settings.contact.lineId} placeholder="ยังไม่ระบุ" onChange={(event) => setSettings((current) => ({ ...current, contact: { ...current.contact, lineId: event.target.value } }))} /><small>แสดงคู่กับ QR เพื่อให้ค้นหาบนคอมพิวเตอร์ได้</small></label>
      <fieldset className="field full site-settings-address"><legend>ที่อยู่ (สูงสุด {MAX_ADDRESS_LINES} บรรทัด)</legend>
        {Array.from({ length: MAX_ADDRESS_LINES }).map((_, index) => (
          <label key={index}>
            <span className="sr-only">ที่อยู่บรรทัดที่ {index + 1}</span>
            <input
              maxLength={120}
              value={settings.contact.addressLines[index] ?? ""}
              placeholder={index === 0 ? "ยังไม่ระบุที่อยู่" : ""}
              onChange={(event) => setSettings((current) => {
                const lines = [...current.contact.addressLines];
                while (lines.length < MAX_ADDRESS_LINES) lines.push("");
                lines[index] = event.target.value;
                return { ...current, contact: { ...current.contact, addressLines: lines } };
              })}
            />
          </label>
        ))}
        <small>บรรทัดที่เว้นว่างจะถูกตัดออกตอนบันทึก · ระบบไม่เติมที่อยู่ตัวอย่างให้</small>
      </fieldset>
      <MediaPicker
        id="line-qr"
        label="QR Code LINE"
        hint="เลือกได้เฉพาะรูปที่เผยแพร่แล้วและเป็นสาธารณะ · ถ้าไม่เลือก หน้าเว็บจะไม่แสดง QR"
        value={settings.contact.lineQrItemId}
        media={media}
        onChange={(id) => setSettings((current) => ({ ...current, contact: { ...current.contact, lineQrItemId: id } }))}
      />
    </div></section>
    <section className="app-panel"><div className="detail-section-head"><div><p>NAVIGATION</p><h2>เมนูเว็บไซต์</h2></div><span>สูงสุด 8 เมนู · เลือกจากหน้าสาธารณะที่มีจริง</span></div><div className="site-editor-list">{settings.navigation.items.map((item, index) => <div className="record-form site-settings-nav-row" key={`${item.href}-${index}`}><label className="field">ข้อความ<input required maxLength={40} value={item.label} onChange={(event) => patchNavigation(index, { label: event.target.value })} /></label><label className="field">หน้าเว็บ<select value={item.href} onChange={(event) => patchNavigation(index, { href: event.target.value })}>{publicNavigationPaths.map((candidate) => <option key={candidate.href} value={candidate.href} disabled={settings.navigation.items.some((current, itemIndex) => itemIndex !== index && current.href === candidate.href)}>{candidate.label} · {candidate.href}</option>)}</select></label><div className="site-editor-order"><button type="button" onClick={() => moveNavigation(index, -1)} disabled={index === 0} aria-label={`เลื่อน ${item.label} ขึ้น`}>↑</button><button type="button" onClick={() => moveNavigation(index, 1)} disabled={index === settings.navigation.items.length - 1} aria-label={`เลื่อน ${item.label} ลง`}>↓</button><button type="button" onClick={() => removeNavigation(index)} disabled={item.href === "/"}>นำออก</button></div></div>)}</div><button className="button button-glass" type="button" disabled={!canAddNavigation} onClick={addNavigation}>+ เพิ่มเมนู</button><div className="record-form site-settings-login-label"><label className="field">ข้อความปุ่มเข้าสู่ระบบ<input required maxLength={40} value={settings.navigation.loginLabel} onChange={(event) => setSettings((current) => ({ ...current, navigation: { ...current.navigation, loginLabel: event.target.value } }))} /></label></div></section>
    <section className="app-panel"><div className="detail-section-head"><div><p>FOOTER</p><h2>ส่วนท้ายเว็บไซต์</h2></div></div><div className="record-form"><label className="field">Copyright<input required maxLength={180} value={settings.footer.copyright} onChange={(event) => setSettings((current) => ({ ...current, footer: { ...current.footer, copyright: event.target.value } }))} /></label><label className="field">ข้อความด้านขวา<input required maxLength={180} value={settings.footer.secondaryText} onChange={(event) => setSettings((current) => ({ ...current, footer: { ...current.footer, secondaryText: event.target.value } }))} /></label></div></section>
    <section className="app-panel site-settings-preview" aria-label="ตัวอย่าง Header และ Footer"><div className="detail-section-head"><div><p>PREVIEW</p><h2>ตัวอย่างส่วนที่ใช้ร่วมกัน</h2></div><span>ยังไม่เผยแพร่จนกว่าจะบันทึกและกดเผยแพร่</span></div><div className="site-settings-preview-header"><div className="brand">{logoPreview ? <span className="brand-mark cms-brand-logo"><img src={logoPreview.previewSrc} alt="" width={logoPreview.width} height={logoPreview.height} /></span> : <span className="brand-mark">{settings.brand.abbreviation}</span>}<span className="brand-name">{settings.brand.name}<small>{settings.brand.tagline}</small></span></div><nav aria-label="ตัวอย่างเมนู">{settings.navigation.items.map((item) => <span key={item.href}>{item.label}</span>)}<b>{settings.navigation.loginLabel}</b></nav></div><div className="site-settings-preview-footer"><span>{settings.footer.copyright}</span><span>{[settings.contact.primaryPhone, settings.contact.secondaryPhone, settings.contact.email, settings.contact.lineId ? `LINE ${settings.contact.lineId}` : ""].filter(Boolean).join(" · ")}</span></div>{previewAddress.length > 0 && <div className="site-settings-preview-footer site-settings-preview-address">{previewAddress.map((line, index) => <span key={index}>{line}</span>)}</div>}</section>
    <section className="app-panel site-editor-save"><label>หมายเหตุการแก้ไข<textarea name="changeNote" maxLength={500} rows={2} placeholder="เช่น เปลี่ยนเมนูและอัปเดตโลโก้บริษัท" /></label><button className="button button-gradient" type="submit" disabled={busy} aria-busy={busy}>{busy ? "กำลังบันทึก…" : "บันทึกเป็น Revision ใหม่"}</button>{message && <p role="status" aria-live="polite">{message}</p>}</section>
  </form>;
}
