"use client";

import { useRef, useState, type FormEvent } from "react";
import { browserSecureId } from "@/lib/browser-secure-id";
import { isConfirmedGalleryUploadResponse } from "@/lib/gallery";

type CategoryOption = { id: string; name: string };
type JobOption = { id: string; companyId: string; label: string };
type QueueItem = { id: string; requestKey: string; file: File; title: string; alt: string; status: "READY" | "UPLOADING" | "DONE" | "ERROR" };

export function GalleryBulkUploadForm({ categories, jobs }: { categories: CategoryOption[]; jobs: JobOption[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [currentProgress, setCurrentProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [visibility, setVisibility] = useState("PUBLIC");

  function selectFiles(files: FileList | null) {
    const allFiles = [...(files ?? [])];
    const selected = allFiles.slice(0, 20);
    const valid = selected.filter((file) => file.size > 0 && file.size <= 20 * 1024 * 1024);
    setQueue(valid.map((file) => ({ id: browserSecureId("queue"), requestKey: browserSecureId("gallery-upload"), file, title: file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 160), alt: "", status: "READY" })));
    setMessage(allFiles.length > 20 ? `รับครั้งละ 20 ภาพ จึงเลือก 20 จาก ${allFiles.length} ภาพ` : selected.length !== valid.length ? "บางไฟล์ถูกตัดออกเพราะว่างหรือใหญ่เกิน 20 MB" : `เลือก ${valid.length} ภาพ กรุณาตรวจชื่อและกรอก Alt text ทุกภาพ`);
  }

  function patch(id: string, values: Partial<QueueItem>) { setQueue((current) => current.map((item) => item.id === id ? { ...item, ...values } : item)); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!queue.length) return setMessage("กรุณาเลือกภาพอย่างน้อยหนึ่งภาพ");
    if (queue.some((item) => !item.title.trim() || item.alt.trim().length < 3)) return setMessage("กรุณากรอกชื่อและ Alt text ให้ครบทุกภาพ");
    const source = new FormData(event.currentTarget);
    const pending = queue.filter((item) => item.status !== "DONE");
    setBusy(true); setMessage(`กำลังเตรียมภาพ 1/${pending.length}`);
    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index];
      patch(item.id, { status: "UPLOADING" }); setCurrentProgress(0); setMessage(`กำลังอัปโหลดภาพ ${index + 1}/${pending.length}: ${item.title}`);
      try {
        const decoded = await decodeImage(item.file);
        if (decoded.width * decoded.height > 80_000_000) {
          decoded.close?.();
          throw new Error("ความละเอียดภาพสูงเกินขีดจำกัด กรุณาลดขนาดภาพก่อนอัปโหลด");
        }
        const display = await resize(decoded, 1800, "image/webp", 0.84);
        const thumbnail = await resize(decoded, 640, "image/webp", 0.8);
        const displayAvif = await resize(decoded, 1800, "image/avif", 0.78, true);
        const thumbnailAvif = await resize(decoded, 640, "image/avif", 0.74, true);
        decoded.close?.();
        const body = new FormData();
        for (const [key, value] of source.entries()) if (!["sourceImages", "jobSelection", "sortStart"].includes(key)) body.append(key, value);
        const start = Number(source.get("sortStart") ?? 0);
        body.set("requestKey", item.requestKey); body.set("title", item.title.trim()); body.set("altText", item.alt.trim()); body.set("sortOrder", String(Number.isSafeInteger(start) && start >= 0 ? start + index : index));
        body.set("original", item.file, item.file.name); addVariant(body, "displayWebp", display); addVariant(body, "thumbnailWebp", thumbnail);
        if (displayAvif) addVariant(body, "displayAvif", displayAvif); if (thumbnailAvif) addVariant(body, "thumbnailAvif", thumbnailAvif);
        await upload(body, setCurrentProgress, (xhr) => { xhrRef.current = xhr; }); patch(item.id, { status: "DONE" });
      } catch (error) {
        patch(item.id, { status: "ERROR" }); setBusy(false); xhrRef.current = null; return setMessage(error instanceof Error ? `${item.title}: ${error.message}` : `${item.title}: อัปโหลดไม่สำเร็จ`);
      }
    }
    xhrRef.current = null; setMessage(`อัปโหลดครบ ${pending.length} ภาพเป็น Draft แล้ว`); window.location.assign("/app/gallery?status=batch_uploaded");
  }

  function cancel() { xhrRef.current?.abort(); xhrRef.current = null; setBusy(false); setMessage("ยกเลิกภาพที่กำลังอัปโหลดแล้ว ภาพที่สำเร็จก่อนหน้านี้ยังอยู่เป็น Draft"); }

  return <form ref={formRef} className="gallery-bulk-form" onSubmit={submit}>
    <div className="record-form"><div className="field full"><label htmlFor="gallery-images">เลือกภาพจริงหลายภาพ *</label><input id="gallery-images" name="sourceImages" type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" disabled={busy} onChange={(event) => selectFiles(event.target.files)} /><small>ครั้งละไม่เกิน 20 ภาพ ภาพละไม่เกิน 20 MB ระบบส่งทีละภาพเพื่อลดความเสี่ยงบนมือถือ</small></div>
      <div className="field"><label htmlFor="bulk-category">หมวดหมู่ *</label><select id="bulk-category" name="categoryId" required disabled={busy}><option value="">เลือกหมวดหมู่</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <div className="field"><label htmlFor="bulk-visibility">การมองเห็น *</label><select id="bulk-visibility" name="visibility" value={visibility} onChange={(event) => setVisibility(event.target.value)} disabled={busy}><option value="PUBLIC">สาธารณะ (อัปโหลดเป็น Draft)</option><option value="INTERNAL">ภายในบริษัท</option><option value="CUSTOMER_JOB">เฉพาะลูกค้าเจ้าของงาน</option></select></div>
      {visibility === "CUSTOMER_JOB" && <div className="field"><label htmlFor="bulk-job">งานของลูกค้า *</label><select id="bulk-job" name="jobSelection" required disabled={busy} onChange={(event) => { const [jobId, companyId] = event.target.value.split("|"); const form = formRef.current; if (form) { (form.elements.namedItem("jobId") as HTMLInputElement).value = jobId || ""; (form.elements.namedItem("companyId") as HTMLInputElement).value = companyId || ""; } }}><option value="">เลือกงาน</option>{jobs.map((job) => <option key={job.id} value={`${job.id}|${job.companyId}`}>{job.label}</option>)}</select><input type="hidden" name="jobId" /><input type="hidden" name="companyId" /></div>}
      <div className="field"><label htmlFor="bulk-taken">วันที่ถ่ายร่วมกัน</label><input id="bulk-taken" name="takenAt" type="date" disabled={busy} /></div><div className="field"><label htmlFor="bulk-location">สถานที่ร่วมกัน</label><input id="bulk-location" name="location" maxLength={200} disabled={busy} /></div><div className="field"><label htmlFor="bulk-reference">Job reference สาธารณะ</label><input id="bulk-reference" name="publicJobReference" maxLength={100} disabled={busy} /></div><div className="field"><label htmlFor="bulk-order">เริ่มลำดับที่</label><input id="bulk-order" name="sortStart" type="number" min={0} max={999980} defaultValue={0} disabled={busy} /></div><div className="field full"><label htmlFor="bulk-caption">คำบรรยายร่วมกัน</label><textarea id="bulk-caption" name="caption" rows={2} maxLength={1000} disabled={busy} /></div></div>
    <div className="gallery-upload-queue">{queue.map((item, index) => <article className={`app-panel ${item.status}`} key={item.id}><div><b>{index + 1}</b><span>{item.file.name}</span><small>{Math.ceil(item.file.size / 1024)} KB · {item.status}</small></div><label>ชื่อภาพ *<input value={item.title} maxLength={160} required disabled={busy || item.status === "DONE"} onChange={(event) => patch(item.id, { title: event.target.value })} /></label><label>Alt text *<input value={item.alt} minLength={3} maxLength={300} required disabled={busy || item.status === "DONE"} onChange={(event) => patch(item.id, { alt: event.target.value })} placeholder="อธิบายสิ่งที่เห็นในภาพอย่างตรงไปตรงมา" /></label></article>)}</div>
    <div className="gallery-upload-actions"><button className="button button-gradient" type="submit" disabled={busy || !queue.length || !categories.length}>{busy ? `กำลังอัปโหลด ${currentProgress}%` : queue.some((item) => item.status === "ERROR") ? "ลองภาพที่ยังไม่สำเร็จอีกครั้ง" : `อัปโหลด ${queue.length} ภาพเป็น Draft`}</button>{busy && <button className="button button-glass" type="button" onClick={cancel}>ยกเลิกภาพปัจจุบัน</button>}{busy && <progress max={100} value={currentProgress} aria-label="ความคืบหน้าภาพปัจจุบัน" />}{message && <p role="status" aria-live="polite">{message}</p>}</div>
  </form>;
}

type DecodedImage = ImageBitmap & { close?: () => void };
type Variant = { blob: Blob; width: number; height: number };
async function decodeImage(file: File): Promise<DecodedImage> { try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { throw new Error("เปิดภาพไม่ได้ กรุณาแปลงเป็น JPEG, PNG หรือ WebP"); } }
function resize(image: DecodedImage, maxWidth: number, type: string, quality: number, optional?: false): Promise<Variant>;
function resize(image: DecodedImage, maxWidth: number, type: string, quality: number, optional: true): Promise<Variant | null>;
async function resize(image: DecodedImage, maxWidth: number, type: string, quality: number, optional = false): Promise<Variant | null> { const scale = Math.min(1, maxWidth / image.width); const width = Math.max(1, Math.round(image.width * scale)); const height = Math.max(1, Math.round(image.height * scale)); const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; canvas.getContext("2d", { alpha: false })?.drawImage(image, 0, 0, width, height); const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality)); if (!blob || blob.type !== type) { if (optional) return null; throw new Error("เบราว์เซอร์สร้าง WebP ไม่ได้ กรุณาใช้ Chrome, Edge หรือ Safari รุ่นใหม่"); } return { blob, width, height }; }
function addVariant(body: FormData, field: string, variant: Variant) { body.set(field, variant.blob, `${field}.${variant.blob.type === "image/avif" ? "avif" : "webp"}`); body.set(`${field}Width`, String(variant.width)); body.set(`${field}Height`, String(variant.height)); }
function upload(body: FormData, onProgress: (value: number) => void, register: (xhr: XMLHttpRequest) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.open("POST", "/api/gallery");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round(event.loaded / event.total * 100));
    xhr.onerror = () => reject(new Error("เครือข่ายขัดข้อง ระบบยังไม่ยืนยันภาพ กรุณาลองใหม่"));
    xhr.onabort = () => reject(new Error("ยกเลิกการอัปโหลดแล้ว"));
    xhr.onload = () => {
      if (isConfirmedGalleryUploadResponse(xhr.status, xhr.response)) resolve();
      else if (xhr.status === 401) reject(new Error("Session หมดอายุ กรุณาเข้าสู่ระบบใหม่"));
      else if (xhr.status === 413) reject(new Error("ข้อมูลภาพรวมใหญ่เกินขีดจำกัด กรุณาลดขนาดไฟล์"));
      else reject(new Error("เซิร์ฟเวอร์ยังไม่ยืนยันภาพ กรุณาตรวจไฟล์ ข้อมูล และสิทธิ์แล้วลองใหม่"));
    };
    xhr.send(body);
  });
}
