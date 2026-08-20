"use client";

import { useRef, useState, type FormEvent } from "react";
import { browserSecureId } from "@/lib/browser-secure-id";

export function QuotationForm() {
  const requestKey = useRef("");
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    try {
      if (!requestKey.current) requestKey.current = browserSecureId("quote");
      const field = event.currentTarget.elements.namedItem("requestKey") as HTMLInputElement;
      field.value = requestKey.current;
      setClientError("");
      setSubmitting(true);
    } catch {
      event.preventDefault();
      setClientError("เบราว์เซอร์นี้สร้างรหัสคำขอที่ปลอดภัยไม่ได้ กรุณาใช้ Chrome, Edge หรือ Safari รุ่นใหม่");
    }
  }

  return <section className="cms-section quotation-form-section" aria-labelledby="quotation-form-title"><div className="shell quotation-layout">
    <div className="cms-section-heading"><span className="eyebrow">ONLINE QUOTATION</span><h2 id="quotation-form-title">ส่งรายละเอียดเพื่อให้ทีมงานประเมิน</h2><p>ระบบจะบันทึกคำขอจริงและออกเลขอ้างอิงเมื่อฐานข้อมูลรับข้อมูลสำเร็จเท่านั้น</p></div>
    <form className="quotation-form" method="post" action="/api/quotation" onSubmit={submit}>
      <input type="hidden" name="requestKey" />
      <label className="quotation-honeypot" aria-hidden="true">เว็บไซต์<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label>
      <label>ชื่อผู้ติดต่อ *<input name="contactName" required minLength={2} maxLength={120} autoComplete="name" /></label>
      <label>เบอร์โทร *<input name="phone" required inputMode="tel" maxLength={30} autoComplete="tel" placeholder="เช่น 0812345678" /></label>
      <label>ชื่อบริษัท / หน่วยงาน<input name="companyName" maxLength={160} autoComplete="organization" /></label>
      <label>อีเมล<input name="email" type="email" maxLength={254} autoComplete="email" /></label>
      <label>LINE ID<input name="lineId" maxLength={100} autoComplete="off" /></label>
      <label>ประเภทรถ *<select name="vehicleType" required defaultValue="MOTORCYCLE"><option value="MOTORCYCLE">รถจักรยานยนต์ทั่วไป</option><option value="BIG_BIKE">Big Bike</option><option value="MIXED">หลายประเภท</option><option value="OTHER">อื่น ๆ</option></select></label>
      <label>ต้นทาง *<input name="origin" required minLength={2} maxLength={180} /></label>
      <label>ปลายทาง *<input name="destination" required minLength={2} maxLength={180} /></label>
      <label>จำนวนรถ *<input name="quantity" type="number" required min={1} max={10000} inputMode="numeric" /></label>
      <label>วันที่ต้องการ<input name="desiredDate" type="date" /></label>
      <fieldset className="quotation-extras"><legend>บริการเพิ่มเติม</legend><label><input type="checkbox" name="extras" value="STORAGE" /> รับฝาก / สต๊อก</label><label><input type="checkbox" name="extras" value="CONTAINER" /> ขึ้นตู้ Container</label><label><input type="checkbox" name="extras" value="INTERNATIONAL" /> งานต่างประเทศ</label><label><input type="checkbox" name="extras" value="LARGE_BATCH" /> งานล็อตใหญ่</label></fieldset>
      <label className="quotation-notes">รายละเอียดเพิ่มเติม<textarea name="notes" maxLength={1500} rows={5} /></label>
      <label className="quotation-consent"><input type="checkbox" name="privacyConsent" value="yes" required /> ยินยอมให้บริษัทใช้ข้อมูลนี้เพื่อติดต่อกลับและประเมินงานตามคำขอนี้</label>
      <button className="button button-gradient" type="submit" disabled={submitting}>{submitting ? "กำลังบันทึกคำขอ…" : "ส่งคำขอใบเสนอราคา"}</button>
      {clientError && <p className="form-error" role="alert">{clientError}</p>}
    </form>
  </div></section>;
}
