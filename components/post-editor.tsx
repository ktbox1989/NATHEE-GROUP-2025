"use client";

import { useRef, useState, type FormEvent } from "react";
import { browserSecureId } from "@/lib/browser-secure-id";
import type { PostContent, PostRobots } from "@/lib/post-cms-content";
import type { CmsSection, CmsSectionType } from "@/lib/site-cms";

type MediaOption = { id: string; label: string };

const types: { value: CmsSectionType; label: string }[] = [
  { value: "CONTENT", label: "เนื้อหา" },
  { value: "FEATURES", label: "รายการจุดเด่น" },
  { value: "FAQ", label: "คำถามที่พบบ่อย / FAQ" },
  { value: "CTA", label: "ปุ่มเรียกให้ติดต่อ" },
];

export function PostEditor({
  action,
  slugField,
  initial,
  media,
  disabled,
}: {
  action: string;
  /** Rendered only when creating: a published post cannot change its URL. */
  slugField?: boolean;
  initial: PostContent;
  media: MediaOption[];
  disabled?: boolean;
}) {
  const [content, setContent] = useState(initial);
  const [message, setMessage] = useState("");
  const payloadRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    if (!content.sections.some((section) => section.enabled)) {
      event.preventDefault();
      return setMessage("ต้องเปิดใช้งานอย่างน้อยหนึ่ง Section");
    }
    try {
      if (payloadRef.current) payloadRef.current.value = JSON.stringify(content);
      // A request key the server uses to make a double submit idempotent.
      if (requestRef.current) requestRef.current.value = browserSecureId("post-save");
      setMessage("กำลังบันทึก Revision ใหม่…");
    } catch {
      event.preventDefault();
      setMessage("เบราว์เซอร์นี้สร้างรหัสคำขอที่ปลอดภัยไม่ได้ กรุณาใช้ Chrome, Edge หรือ Safari รุ่นใหม่");
    }
  }

  const patch = (index: number, next: Partial<CmsSection>) =>
    setContent((current) => ({
      ...current,
      sections: current.sections.map((section, position) => (position === index ? { ...section, ...next } : section)),
    }));

  return (
    <form className="cms-editor" action={action} method="post" onSubmit={submit}>
      <input ref={payloadRef} type="hidden" name="contentJson" />
      <input ref={requestRef} type="hidden" name="requestKey" />

      {slugField && (
        <label className="field">
          <span>Slug (ใช้เป็น URL /news/&lt;slug&gt;/ และเปลี่ยนภายหลังไม่ได้)</span>
          <input name="slug" required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="new-route-bangkok" />
        </label>
      )}

      <label className="field">
        <span>หัวข้อ (H1)</span>
        <input value={content.title} maxLength={300} onChange={(event) => setContent({ ...content, title: event.target.value })} />
      </label>
      <label className="field">
        <span>สรุปย่อ (แสดงในหน้ารวมข่าว)</span>
        <textarea value={content.excerpt} maxLength={500} rows={2} onChange={(event) => setContent({ ...content, excerpt: event.target.value })} />
      </label>

      <fieldset className="field-group">
        <legend>หมวดหมู่</legend>
        <label className="field">
          <span>รหัส (ปล่อยว่างหากไม่มีหมวดหมู่)</span>
          <input
            value={content.category?.id ?? ""}
            maxLength={100}
            onChange={(event) =>
              setContent({
                ...content,
                category: event.target.value ? { id: event.target.value, label: content.category?.label ?? "" } : null,
              })
            }
          />
        </label>
        <label className="field">
          <span>ชื่อที่แสดง</span>
          <input
            value={content.category?.label ?? ""}
            maxLength={80}
            disabled={!content.category}
            onChange={(event) =>
              setContent({ ...content, category: content.category ? { ...content.category, label: event.target.value } : null })
            }
          />
        </label>
      </fieldset>

      <label className="field">
        <span>ภาพหลัก</span>
        <select value={content.featuredImageItemId} onChange={(event) => setContent({ ...content, featuredImageItemId: event.target.value })}>
          <option value="">ไม่มีภาพหลัก</option>
          {media.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>

      <fieldset className="field-group">
        <legend>SEO</legend>
        <label className="field">
          <span>Title</span>
          <input value={content.seo.title} maxLength={120} onChange={(event) => setContent({ ...content, seo: { ...content.seo, title: event.target.value } })} />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea value={content.seo.description} maxLength={300} rows={2} onChange={(event) => setContent({ ...content, seo: { ...content.seo, description: event.target.value } })} />
        </label>
        <label className="field">
          <span>การจัดทำดัชนี</span>
          <select value={content.seo.robots} onChange={(event) => setContent({ ...content, seo: { ...content.seo, robots: event.target.value as PostRobots } })}>
            <option value="INDEX">INDEX — ให้ค้นหาเจอ</option>
            <option value="NOINDEX">NOINDEX — เผยแพร่แต่ไม่ให้ค้นหาเจอ</option>
          </select>
        </label>
      </fieldset>

      {content.sections.map((section, index) => (
        <fieldset className="field-group" key={section.id}>
          <legend>Section {index + 1}</legend>
          <label className="field">
            <span>ชนิด</span>
            <select value={section.type} onChange={(event) => patch(index, { type: event.target.value as CmsSectionType })}>
              {types.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>หัวข้อ</span>
            <input value={section.heading} maxLength={180} onChange={(event) => patch(index, { heading: event.target.value })} />
          </label>
          <label className="field">
            <span>เนื้อหา</span>
            <textarea value={section.body} maxLength={2000} rows={4} onChange={(event) => patch(index, { body: event.target.value })} />
          </label>
          <label className="field">
            <span>ภาพประกอบ</span>
            <select value={section.imageItemId} onChange={(event) => patch(index, { imageItemId: event.target.value })}>
              <option value="">ไม่มีภาพ</option>
              {media.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="field field-inline">
            <input type="checkbox" checked={section.enabled} onChange={(event) => patch(index, { enabled: event.target.checked })} />
            <span>เปิดใช้งาน</span>
          </label>
          {content.sections.length > 1 && (
            <button
              type="button"
              className="button button-glass button-small"
              onClick={() => setContent({ ...content, sections: content.sections.filter((_, position) => position !== index) })}
            >
              ลบ Section นี้
            </button>
          )}
        </fieldset>
      ))}

      <div className="cms-editor-actions">
        <button
          type="button"
          className="button button-glass"
          onClick={() =>
            setContent({
              ...content,
              sections: [
                ...content.sections,
                {
                  id: `section-${content.sections.length + 1}-${Math.min(content.sections.length + 1, 20)}`,
                  type: "CONTENT",
                  enabled: true,
                  eyebrow: "",
                  heading: "หัวข้อใหม่",
                  body: "",
                  imageItemId: "",
                  primaryLabel: "",
                  primaryHref: "",
                  secondaryLabel: "",
                  secondaryHref: "",
                  galleryCategorySlug: "",
                  galleryLimit: 12,
                  items: [],
                },
              ],
            })
          }
        >
          เพิ่ม Section
        </button>
        <label className="field">
          <span>หมายเหตุการแก้ไข</span>
          <input name="changeNote" maxLength={500} />
        </label>
        <button type="submit" className="button button-gradient" disabled={disabled}>บันทึก Revision</button>
      </div>
      {message && <p className="form-message">{message}</p>}
    </form>
  );
}
