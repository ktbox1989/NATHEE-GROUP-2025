"use client";

import { useRef, useState, type FormEvent } from "react";
import { browserSecureId } from "@/lib/browser-secure-id";

type Variant = { blob: Blob; width: number; height: number };
type DecodedImage = ImageBitmap | HTMLImageElement;

export function MotorcycleImageUploadForm({ motorcycleId }: { motorcycleId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const requestKeyRef = useRef("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formElement = event.currentTarget;
    const file = fileRef.current?.files?.[0];
    if (!file || file.size < 1 || file.size > 10 * 1024 * 1024) {
      setMessage("กรุณาเลือกภาพขนาดไม่เกิน 10 MB");
      return;
    }
    setBusy(true);
    setProgress(0);
    setMessage("กำลังเตรียมภาพขนาดเหมาะสม โดยไฟล์ต้นฉบับจะถูกเก็บเป็นหลักฐาน Private");
    try {
      const decoded = await decodeImage(file);
      if (decoded.width * decoded.height > 80_000_000) {
        if ("close" in decoded) decoded.close();
        throw new Error("ความละเอียดภาพสูงเกินขีดจำกัด กรุณาลดขนาดภาพก่อนอัปโหลด");
      }
      const displayWebp = await resize(decoded, 1600, "image/webp", 0.84);
      const thumbnailWebp = await resize(decoded, 640, "image/webp", 0.8);
      const displayAvif = await resize(decoded, 1600, "image/avif", 0.78, true);
      const thumbnailAvif = await resize(decoded, 640, "image/avif", 0.74, true);
      if ("close" in decoded) decoded.close();

      const body = new FormData(formElement);
      if (!requestKeyRef.current) requestKeyRef.current = browserSecureId("motorcycle-image");
      body.set("requestKey", requestKeyRef.current);
      body.set("image", file, file.name);
      addVariant(body, "displayWebp", displayWebp);
      addVariant(body, "thumbnailWebp", thumbnailWebp);
      if (displayAvif) addVariant(body, "displayAvif", displayAvif);
      if (thumbnailAvif) addVariant(body, "thumbnailAvif", thumbnailAvif);
      setMessage("กำลังส่งไฟล์ต้นฉบับและภาพสำหรับหน้าจอ");
      await upload(`/api/motorcycles/${encodeURIComponent(motorcycleId)}/images`, body, setProgress, (xhr) => { xhrRef.current = xhr; });
      requestKeyRef.current = "";
      setMessage("บันทึกภาพและตรวจสอบ metadata สำเร็จ กำลังรีเฟรชรายการ");
      window.location.assign(`/app/motorcycles/${encodeURIComponent(motorcycleId)}?status=image_uploaded`);
    } catch (error) {
      setBusy(false);
      xhrRef.current = null;
      setMessage(error instanceof Error ? error.message : "อัปโหลดไม่สำเร็จ ไฟล์ยังไม่ถูกยืนยันในรายการ");
    }
  }

  function cancel() {
    xhrRef.current?.abort();
    xhrRef.current = null;
    setBusy(false);
    setMessage("ยกเลิกการส่งแล้ว กรุณารีเฟรชเพื่อตรวจสอบสถานะก่อนลองใหม่");
  }

  return <form className="record-form upload-form" onSubmit={submit} encType="multipart/form-data">
    <div className="field"><label htmlFor="category">ประเภทภาพ</label><select id="category" name="category" disabled={busy}><option value="FRONT">ด้านหน้า</option><option value="REAR">ด้านหลัง</option><option value="LEFT">ด้านซ้าย</option><option value="RIGHT">ด้านขวา</option><option value="DAMAGE">ตำหนิ / ความเสียหาย</option><option value="DELIVERY">ส่งมอบ</option><option value="OTHER">อื่นๆ</option></select></div>
    <div className="field"><label htmlFor="image">เลือกรูป (ไม่เกิน 10 MB)</label><input ref={fileRef} id="image" name="image" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" required disabled={busy} /><small>ระบบเก็บต้นฉบับแบบ Private และสร้างภาพย่ออัตโนมัติเพื่อลดข้อมูลบนมือถือ</small></div>
    <div className="full evidence-upload-actions"><button className="button button-gradient" type="submit" disabled={busy}>{busy ? `กำลังอัปโหลด ${progress}%` : "อัปโหลดรูป"}</button>{busy && <button className="button button-glass" type="button" onClick={cancel}>ยกเลิก</button>}{busy && <progress max={100} value={progress} aria-label="ความคืบหน้าการอัปโหลดรูป" />}{message && <p role="status" aria-live="polite">{message}</p>}</div>
  </form>;
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch { /* Use the browser image decoder fallback below. */ }
  }
  const source = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("เปิดภาพไม่ได้ กรุณาแปลงเป็น JPEG, PNG หรือ WebP แล้วลองใหม่"));
      image.src = source;
    });
  } finally {
    URL.revokeObjectURL(source);
  }
}

function resize(image: DecodedImage, maxDimension: number, type: string, quality: number, optional?: false): Promise<Variant>;
function resize(image: DecodedImage, maxDimension: number, type: string, quality: number, optional: true): Promise<Variant | null>;
async function resize(image: DecodedImage, maxDimension: number, type: string, quality: number, optional = false): Promise<Variant | null> {
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("อุปกรณ์ไม่สามารถเตรียมภาพได้");
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob || blob.type !== type) {
    if (optional) return null;
    throw new Error("เบราว์เซอร์สร้าง WebP ไม่ได้ กรุณาใช้ Chrome, Edge หรือ Safari รุ่นใหม่");
  }
  return { blob, width, height };
}

function addVariant(body: FormData, field: string, variant: Variant) {
  body.set(field, variant.blob, `${field}.${variant.blob.type === "image/avif" ? "avif" : "webp"}`);
  body.set(`${field}Width`, String(variant.width));
  body.set(`${field}Height`, String(variant.height));
}

function upload(url: string, body: FormData, onProgress: (value: number) => void, register: (xhr: XMLHttpRequest) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.open("POST", url);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round(event.loaded / event.total * 100));
    xhr.onerror = () => reject(new Error("เครือข่ายขัดข้อง ระบบยังไม่ยืนยันภาพ กรุณาลองใหม่"));
    xhr.onabort = () => reject(new Error("ยกเลิกการอัปโหลดแล้ว"));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response?.ok === true) resolve();
      else if (xhr.status === 401) reject(new Error("Session หมดอายุ กรุณาเข้าสู่ระบบใหม่"));
      else if (xhr.status === 413) reject(new Error("ข้อมูลภาพรวมใหญ่เกินขีดจำกัด กรุณาเลือกภาพต้นฉบับขนาดเล็กลง"));
      else reject(new Error("ระบบปฏิเสธภาพหรือบันทึกไม่ครบ กรุณาตรวจไฟล์แล้วลองใหม่"));
    };
    xhr.send(body);
  });
}
