"use client";

import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { browserSecureUuid } from "@/lib/browser-secure-id";

type DeliveryImageOption = { id: string; label: string };

export function ProofOfDeliveryForm({ motorcycleId, deliveryImages, defaultDeliveredAt }: { motorcycleId: string; deliveryImages: DeliveryImageOption[]; defaultDeliveredAt: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const requestKeyRef = useRef("");
  const drawingRef = useRef(false);
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => { resetCanvas(canvasRef.current); }, []);

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (busy) return;
    const canvas = event.currentTarget;
    const point = canvasPoint(canvas, event.clientX, event.clientY);
    const context = canvas.getContext("2d");
    if (!context) return;
    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || busy) return;
    const canvas = event.currentTarget;
    const point = canvasPoint(canvas, event.clientX, event.clientY);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.lineTo(point.x, point.y);
    context.stroke();
    setSigned(true);
  }

  function pointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formElement = event.currentTarget;
    const canvas = canvasRef.current;
    if (!canvas || !signed) return setMessage("กรุณาให้ผู้รับลงลายเซ็นก่อนบันทึก");
    setBusy(true);
    setProgress(0);
    setMessage("กำลังเตรียมและส่งหลักฐานส่งมอบแบบ Private");
    try {
      const signature = await canvasBlob(canvas);
      if (signature.size < 200 || signature.size > 1024 * 1024) throw new Error("ข้อมูลลายเซ็นไม่ผ่านขนาดที่กำหนด กรุณาล้างแล้วลงนามใหม่");
      const body = new FormData(formElement);
      if (!requestKeyRef.current) requestKeyRef.current = browserSecureUuid();
      body.set("requestKey", requestKeyRef.current);
      body.set("signature", signature, "pod-signature.png");
      body.set("signatureWidth", String(canvas.width));
      body.set("signatureHeight", String(canvas.height));
      await upload(`/api/motorcycles/${encodeURIComponent(motorcycleId)}/pod`, body, setProgress, (xhr) => { xhrRef.current = xhr; });
      requestKeyRef.current = "";
      setMessage("บันทึก POD รูปส่งมอบ และลายเซ็นครบแล้ว กำลังรีเฟรช");
      window.location.assign(`/app/motorcycles/${encodeURIComponent(motorcycleId)}?status=pod_created`);
    } catch (error) {
      setBusy(false);
      xhrRef.current = null;
      setMessage(error instanceof Error ? error.message : "บันทึก POD ไม่สำเร็จ ระบบยังไม่ยืนยันหลักฐาน");
    }
  }

  function clearSignature() {
    if (busy) return;
    resetCanvas(canvasRef.current);
    setSigned(false);
    setMessage("ล้างลายเซ็นแล้ว");
  }

  function cancel() {
    xhrRef.current?.abort();
    xhrRef.current = null;
    setBusy(false);
    setMessage("ยกเลิกการส่งแล้ว กรุณารีเฟรชเพื่อตรวจสอบสถานะก่อนลองใหม่");
  }

  return <form className="record-form pod-form" onSubmit={submit} encType="multipart/form-data">
    <div className="field"><label htmlFor="recipientName">ชื่อผู้รับจริง *</label><input id="recipientName" name="recipientName" maxLength={160} autoComplete="name" required disabled={busy} /></div>
    <div className="field"><label htmlFor="recipientPhone">เบอร์ผู้รับ</label><input id="recipientPhone" name="recipientPhone" minLength={6} maxLength={50} inputMode="tel" autoComplete="tel" disabled={busy} /></div>
    <div className="field"><label htmlFor="deliveryLocation">สถานที่ส่งมอบ *</label><input id="deliveryLocation" name="deliveryLocation" minLength={2} maxLength={300} required disabled={busy} /></div>
    <div className="field"><label htmlFor="deliveredAt">วันเวลาส่งมอบ (เวลาไทย) *</label><input id="deliveredAt" name="deliveredAt" type="datetime-local" defaultValue={defaultDeliveredAt} required disabled={busy} /></div>
    <div className="field full"><label htmlFor="podEvidenceImageId">รูปส่งมอบ DELIVERY *</label><select id="podEvidenceImageId" name="evidenceImageId" required defaultValue="" disabled={busy}><option value="">เลือกรูปหลักฐาน</option>{deliveryImages.map((image) => <option key={image.id} value={image.id}>{image.label}</option>)}</select></div>
    <div className="field full"><label htmlFor="podNotes">หมายเหตุ</label><textarea id="podNotes" name="notes" rows={3} maxLength={2000} disabled={busy} /></div>
    <div className="field full pod-signature-field"><div className="pod-signature-head"><div><label htmlFor="podSignature">ลายเซ็นผู้รับ *</label><small>ลงนามในกรอบด้วยนิ้วหรือเมาส์ ระบบไม่เก็บลายเซ็นใน Browser</small></div><button type="button" className="button button-glass button-small" onClick={clearSignature} disabled={busy}>ล้างลายเซ็น</button></div><canvas ref={canvasRef} id="podSignature" width={720} height={240} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} aria-label="พื้นที่ลงลายเซ็นผู้รับ" role="img" /></div>
    <label className="consent-field full"><input type="checkbox" name="signatureAttestation" value="confirmed" required disabled={busy} /><span>ยืนยันว่าผู้รับลงนามต่อหน้าผู้บันทึกหรือได้ตรวจสอบตัวตนผู้รับแล้ว *</span></label>
    <div className="full pod-submit-actions"><button className="button button-gradient" type="submit" disabled={busy || !signed}>{busy ? `กำลังบันทึก ${progress}%` : "บันทึกหลักฐานส่งมอบ"}</button>{busy && <button className="button button-glass" type="button" onClick={cancel}>ยกเลิก</button>}{busy && <progress max={100} value={progress} aria-label="ความคืบหน้าการบันทึก POD" />}{message && <p role="status" aria-live="polite">{message}</p>}</div>
  </form>;
}

function resetCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#111111";
  context.lineWidth = 4;
  context.lineCap = "round";
  context.lineJoin = "round";
}

function canvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  return { x: (clientX - rect.left) * canvas.width / rect.width, y: (clientY - rect.top) * canvas.height / rect.height };
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob?.type === "image/png" ? resolve(blob) : reject(new Error("อุปกรณ์ไม่สามารถสร้างไฟล์ลายเซ็น PNG ได้")), "image/png"));
}

function upload(url: string, body: FormData, onProgress: (value: number) => void, register: (xhr: XMLHttpRequest) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.open("POST", url);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round(event.loaded / event.total * 100));
    xhr.onerror = () => reject(new Error("เครือข่ายขัดข้อง ระบบยังไม่ยืนยัน POD กรุณาลองใหม่"));
    xhr.onabort = () => reject(new Error("ยกเลิกการบันทึกแล้ว"));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response?.ok === true) resolve();
      else if (xhr.status === 401) reject(new Error("Session หมดอายุ กรุณาเข้าสู่ระบบใหม่"));
      else if (xhr.status === 409) reject(new Error("รถคันนี้มี POD ที่ใช้งานอยู่แล้ว กรุณารีเฟรช"));
      else reject(new Error("ข้อมูล รูป หรือลายเซ็นไม่ผ่านการตรวจสอบ ระบบยังไม่บันทึก POD"));
    };
    xhr.send(body);
  });
}
