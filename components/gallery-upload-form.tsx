"use client";

import { useRef, useState, type FormEvent } from "react";

type CategoryOption = { id: string; name: string };
type JobOption = { id: string; companyId: string; label: string };

export function GalleryUploadForm({ categories, jobs }: { categories: CategoryOption[]; jobs: JobOption[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [visibility, setVisibility] = useState("PUBLIC");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const source = new FormData(form);
    const image = source.get("sourceImage");
    if (!(image instanceof File) || !image.size) return setMessage("กรุณาเลือกภาพจริงก่อนอัปโหลด");
    setBusy(true); setProgress(0); setMessage("กำลังเตรียมภาพ WebP สำหรับเว็บ…");
    try {
      const decoded = await decodeImage(image);
      const display = await resize(decoded, 1800, "image/webp", 0.84);
      const thumbnail = await resize(decoded, 640, "image/webp", 0.8);
      const displayAvif = await resize(decoded, 1800, "image/avif", 0.78, true);
      const thumbnailAvif = await resize(decoded, 640, "image/avif", 0.74, true);
      decoded.close?.();
      const body = new FormData();
      for (const [key, value] of source.entries()) if (key !== "sourceImage") body.append(key, value);
      body.set("requestKey", crypto.randomUUID());
      body.set("original", image, image.name);
      addVariant(body, "displayWebp", display);
      addVariant(body, "thumbnailWebp", thumbnail);
      if (displayAvif) addVariant(body, "displayAvif", displayAvif);
      if (thumbnailAvif) addVariant(body, "thumbnailAvif", thumbnailAvif);
      setMessage("กำลังอัปโหลดภาพและตรวจ checksum…");
      const target = await upload(body, setProgress);
      window.location.assign(target || "/app/gallery?status=uploaded");
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "อัปโหลดไม่สำเร็จ กรุณาลองใหม่");
    }
  }

  return <form ref={formRef} className="record-form gallery-upload-form" onSubmit={submit}>
    <div className="field"><label htmlFor="gallery-image">ภาพจริง *</label><input id="gallery-image" name="sourceImage" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" required disabled={busy} /><small>สูงสุด 20 MB ระบบสร้าง WebP และ AVIF เมื่อเบราว์เซอร์รองรับ</small></div>
    <div className="field"><label htmlFor="gallery-category">หมวดหมู่ *</label><select id="gallery-category" name="categoryId" required disabled={busy || !categories.length}><option value="">เลือกหมวดหมู่</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    <div className="field"><label htmlFor="gallery-title">ชื่อภาพ *</label><input id="gallery-title" name="title" maxLength={160} required disabled={busy} /></div>
    <div className="field"><label htmlFor="gallery-alt">Alt text *</label><input id="gallery-alt" name="altText" maxLength={300} required disabled={busy} aria-describedby="gallery-alt-help" /><small id="gallery-alt-help">อธิบายสิ่งที่อยู่ในภาพเพื่อการเข้าถึงและ SEO ห้ามใส่คำโฆษณาซ้ำ ๆ</small></div>
    <div className="field full"><label htmlFor="gallery-caption">คำบรรยาย</label><textarea id="gallery-caption" name="caption" rows={3} maxLength={1000} disabled={busy} /></div>
    <div className="field"><label htmlFor="gallery-taken-at">วันที่ถ่ายภาพ</label><input id="gallery-taken-at" name="takenAt" type="date" disabled={busy} /></div>
    <div className="field"><label htmlFor="gallery-location">สถานที่</label><input id="gallery-location" name="location" maxLength={200} disabled={busy} /></div>
    <div className="field"><label htmlFor="gallery-job-reference">Job reference ที่อนุญาตให้แสดง</label><input id="gallery-job-reference" name="publicJobReference" maxLength={100} disabled={busy} /><small>ห้ามใส่ชื่อ/ข้อมูลลูกค้าหากยังไม่ได้รับอนุญาต</small></div>
    <div className="field"><label htmlFor="gallery-visibility">การมองเห็น *</label><select id="gallery-visibility" name="visibility" value={visibility} onChange={(event) => setVisibility(event.target.value)} disabled={busy}><option value="PUBLIC">สาธารณะ (ยังเป็น Draft)</option><option value="INTERNAL">ภายในบริษัท</option><option value="CUSTOMER_JOB">เฉพาะลูกค้าที่เป็นเจ้าของงาน</option></select></div>
    {visibility === "CUSTOMER_JOB" && <div className="field"><label htmlFor="gallery-job">งานของลูกค้า *</label><select id="gallery-job" name="jobSelection" required disabled={busy} onChange={(event) => { const [jobId, companyId] = event.target.value.split("|"); formRef.current?.querySelector<HTMLInputElement>("[name=jobId]")?.setAttribute("value", jobId || ""); formRef.current?.querySelector<HTMLInputElement>("[name=companyId]")?.setAttribute("value", companyId || ""); }}><option value="">เลือกงาน</option>{jobs.map((job) => <option key={job.id} value={`${job.id}|${job.companyId}`}>{job.label}</option>)}</select><input type="hidden" name="jobId" /><input type="hidden" name="companyId" /></div>}
    <div className="field"><label htmlFor="gallery-sort">ลำดับ</label><input id="gallery-sort" name="sortOrder" type="number" min={0} max={1000000} defaultValue={0} disabled={busy} /></div>
    <div className="full gallery-upload-actions"><button className="button button-gradient" type="submit" disabled={busy || !categories.length}>{busy ? `กำลังอัปโหลด ${progress}%` : "อัปโหลดเป็นฉบับร่าง"}</button>{busy && <progress max={100} value={progress} aria-label="ความคืบหน้าการอัปโหลด" />}{message && <p role="status" aria-live="polite">{message}</p>}</div>
  </form>;
}

type DecodedImage = ImageBitmap & { close?: () => void };
type Variant = { blob: Blob; width: number; height: number };

async function decodeImage(file: File): Promise<DecodedImage> {
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error("เบราว์เซอร์นี้เปิดภาพไม่ได้ กรุณาแปลงภาพเป็น JPEG, PNG หรือ WebP ก่อน"); }
}

async function resize(image: DecodedImage, maxWidth: number, type: string, quality: number, optional = false): Promise<Variant | null> {
  const scale = Math.min(1, maxWidth / image.width);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  canvas.getContext("2d", { alpha: false })?.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob || blob.type !== type) {
    if (optional) return null;
    throw new Error("เบราว์เซอร์ไม่สามารถสร้าง WebP ได้ กรุณาใช้ Chrome, Edge หรือ Safari รุ่นใหม่");
  }
  return { blob, width, height };
}

function addVariant(body: FormData, field: string, variant: Variant) {
  body.set(field, variant.blob, `${field}.${variant.blob.type === "image/avif" ? "avif" : "webp"}`);
  body.set(`${field}Width`, String(variant.width)); body.set(`${field}Height`, String(variant.height));
}

function upload(body: FormData, onProgress: (value: number) => void): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open("POST", "/api/gallery");
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round(event.loaded / event.total * 100));
    xhr.onerror = () => reject(new Error("เครือข่ายขัดข้อง ภาพยังไม่ถูกเผยแพร่"));
    xhr.onload = () => xhr.status >= 200 && xhr.status < 400 ? resolve(xhr.responseURL) : reject(new Error("เซิร์ฟเวอร์ปฏิเสธไฟล์ กรุณาตรวจชนิดและขนาดภาพ"));
    xhr.send(body);
  });
}
