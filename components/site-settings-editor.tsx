"use client";
/* eslint-disable @next/next/no-img-element -- preview uses the authorization-aware Gallery route */

import { useRef, useState, type FormEvent } from "react";
import { browserSecureId } from "@/lib/browser-secure-id";
import { SITE_PAGE_DEFINITIONS } from "@/lib/site-cms-content";
import type { SiteNavigationItem, SiteSettings } from "@/lib/site-settings";

type MediaOption = { id: string; label: string };
const publicNavigationPaths = [
  ...Object.values(SITE_PAGE_DEFINITIONS).map((definition) => ({ label: definition.label, href: definition.path })),
  { label: "ผลงาน", href: "/gallery" },
];

export function SiteSettingsEditor({ initial, media }: { initial: SiteSettings; media: MediaOption[] }) {
  const [settings, setSettings] = useState(initial);
  const [message, setMessage] = useState("");
  const payloadRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    try {
      if (payloadRef.current) payloadRef.current.value = JSON.stringify(settings);
      if (requestRef.current) requestRef.current.value = browserSecureId("site-settings-save");
      setMessage("กำลังบันทึก Revision ใหม่…");
    } catch {
      event.preventDefault();
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

  const canAddNavigation = settings.navigation.items.length < 8 && publicNavigationPaths.some((candidate) => !settings.navigation.items.some((item) => item.href === candidate.href));

  return <form className="site-editor" action="/api/site-settings/revisions" method="post" onSubmit={submit}>
    <input ref={requestRef} type="hidden" name="requestKey" />
    <input ref={payloadRef} type="hidden" name="settingsJson" />
    <section className="app-panel"><div className="detail-section-head"><div><p>BRAND</p><h2>ชื่อและโลโก้</h2></div><span>ใช้ร่วมกันทุกหน้าสาธารณะ</span></div><div className="record-form">
      <label className="field">ชื่อแบรนด์<input required maxLength={120} value={settings.brand.name} onChange={(event) => setSettings((current) => ({ ...current, brand: { ...current.brand, name: event.target.value } }))} /></label>
      <label className="field">ชื่อบริษัทตามกฎหมาย<input required maxLength={180} value={settings.brand.legalName} onChange={(event) => setSettings((current) => ({ ...current, brand: { ...current.brand, legalName: event.target.value } }))} /></label>
      <label className="field">อักษรย่อ<input required maxLength={6} pattern="[A-Za-z0-9]{1,6}" value={settings.brand.abbreviation} onChange={(event) => setSettings((current) => ({ ...current, brand: { ...current.brand, abbreviation: event.target.value } }))} /></label>
      <label className="field">คำอธิบายใต้แบรนด์<input required maxLength={120} value={settings.brand.tagline} onChange={(event) => setSettings((current) => ({ ...current, brand: { ...current.brand, tagline: event.target.value } }))} /></label>
      <label className="field full">โลโก้จาก Media Library<select value={settings.brand.logoItemId} onChange={(event) => setSettings((current) => ({ ...current, brand: { ...current.brand, logoItemId: event.target.value } }))}><option value="">ใช้อักษรย่อ</option>{media.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    </div></section>
    <section className="app-panel"><div className="detail-section-head"><div><p>CONTACT</p><h2>เบอร์โทรศัพท์</h2></div><span>ไม่รองรับข้อมูลจำลอง</span></div><div className="record-form">
      <label className="field">เบอร์หลัก<input required maxLength={20} pattern="\+?[0-9-]{7,20}" value={settings.contact.primaryPhone} onChange={(event) => setSettings((current) => ({ ...current, contact: { ...current.contact, primaryPhone: event.target.value } }))} /></label>
      <label className="field">เบอร์สำรอง<input maxLength={20} pattern="\+?[0-9-]{7,20}" value={settings.contact.secondaryPhone} onChange={(event) => setSettings((current) => ({ ...current, contact: { ...current.contact, secondaryPhone: event.target.value } }))} /></label>
    </div></section>
    <section className="app-panel"><div className="detail-section-head"><div><p>NAVIGATION</p><h2>เมนูเว็บไซต์</h2></div><span>สูงสุด 8 เมนู · เลือกจากหน้าสาธารณะที่มีจริง</span></div><div className="site-editor-list">{settings.navigation.items.map((item, index) => <div className="record-form site-settings-nav-row" key={`${item.href}-${index}`}><label className="field">ข้อความ<input required maxLength={40} value={item.label} onChange={(event) => patchNavigation(index, { label: event.target.value })} /></label><label className="field">หน้าเว็บ<select value={item.href} onChange={(event) => patchNavigation(index, { href: event.target.value })}>{publicNavigationPaths.map((candidate) => <option key={candidate.href} value={candidate.href} disabled={settings.navigation.items.some((current, itemIndex) => itemIndex !== index && current.href === candidate.href)}>{candidate.label} · {candidate.href}</option>)}</select></label><div className="site-editor-order"><button type="button" onClick={() => moveNavigation(index, -1)} disabled={index === 0} aria-label={`เลื่อน ${item.label} ขึ้น`}>↑</button><button type="button" onClick={() => moveNavigation(index, 1)} disabled={index === settings.navigation.items.length - 1} aria-label={`เลื่อน ${item.label} ลง`}>↓</button><button type="button" onClick={() => removeNavigation(index)} disabled={item.href === "/"}>นำออก</button></div></div>)}</div><button className="button button-glass" type="button" disabled={!canAddNavigation} onClick={addNavigation}>+ เพิ่มเมนู</button><div className="record-form site-settings-login-label"><label className="field">ข้อความปุ่มเข้าสู่ระบบ<input required maxLength={40} value={settings.navigation.loginLabel} onChange={(event) => setSettings((current) => ({ ...current, navigation: { ...current.navigation, loginLabel: event.target.value } }))} /></label></div></section>
    <section className="app-panel"><div className="detail-section-head"><div><p>FOOTER</p><h2>ส่วนท้ายเว็บไซต์</h2></div></div><div className="record-form"><label className="field">Copyright<input required maxLength={180} value={settings.footer.copyright} onChange={(event) => setSettings((current) => ({ ...current, footer: { ...current.footer, copyright: event.target.value } }))} /></label><label className="field">ข้อความด้านขวา<input required maxLength={180} value={settings.footer.secondaryText} onChange={(event) => setSettings((current) => ({ ...current, footer: { ...current.footer, secondaryText: event.target.value } }))} /></label></div></section>
    <section className="app-panel site-settings-preview" aria-label="ตัวอย่าง Header และ Footer"><div className="detail-section-head"><div><p>PREVIEW</p><h2>ตัวอย่างส่วนที่ใช้ร่วมกัน</h2></div><span>ยังไม่เผยแพร่จนกว่าจะบันทึกและกดเผยแพร่</span></div><div className="site-settings-preview-header"><div className="brand">{settings.brand.logoItemId ? <span className="brand-mark cms-brand-logo"><img src={`/api/gallery/images/${settings.brand.logoItemId}?role=thumbnail`} alt="" /></span> : <span className="brand-mark">{settings.brand.abbreviation}</span>}<span className="brand-name">{settings.brand.name}<small>{settings.brand.tagline}</small></span></div><nav aria-label="ตัวอย่างเมนู">{settings.navigation.items.map((item) => <span key={item.href}>{item.label}</span>)}<b>{settings.navigation.loginLabel}</b></nav></div><div className="site-settings-preview-footer"><span>{settings.footer.copyright}</span><span>{settings.contact.primaryPhone}{settings.contact.secondaryPhone ? ` · ${settings.contact.secondaryPhone}` : ""}</span></div></section>
    <section className="app-panel site-editor-save"><label>หมายเหตุการแก้ไข<textarea name="changeNote" maxLength={500} rows={2} placeholder="เช่น เปลี่ยนเมนูและอัปเดตโลโก้บริษัท" /></label><button className="button button-gradient" type="submit">บันทึกเป็น Revision ใหม่</button>{message && <p role="status" aria-live="polite">{message}</p>}</section>
  </form>;
}
