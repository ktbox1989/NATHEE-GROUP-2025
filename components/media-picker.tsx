"use client";

import type { MediaPickerOption } from "@/lib/media-picker";

/**
 * Choosing one photograph from the Media Library.
 *
 * Two rules it exists to keep. Everything offered can actually be published —
 * the options come from a `resolvePublicMedia` resolution, so the picker cannot
 * suggest an item whose publish would then be refused for being a draft, being
 * private, or having no raster variant. And the preview is the same
 * `/assets/media/…` source the public site will use, never the authenticated
 * gallery route and never a storage key.
 *
 * "Not selected" is a first-class choice rather than an oversight: several of
 * these fields are legitimately empty, and the copy says what empty means so
 * the Owner is not left wondering whether they forgot something.
 */
export function MediaPicker({
  id,
  label,
  hint,
  value,
  media,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  media: MediaPickerOption[];
  onChange: (id: string) => void;
}) {
  const selected = media.find((option) => option.id === value) ?? null;
  const selectId = `media-picker-${id}`;

  return (
    <div className="field full media-picker">
      <label htmlFor={selectId}>{label}</label>
      <div className="media-picker-body">
        <div className="media-picker-preview" aria-live="polite">
          {selected ? (
            /* eslint-disable-next-line @next/next/no-img-element -- the delivery contract builds the src; next/image would rewrite it */
            <img
              src={selected.previewSrc}
              alt={`ตัวอย่าง ${label}: ${selected.label}`}
              width={selected.width}
              height={selected.height}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="media-picker-empty">ยังไม่ได้เลือก</span>
          )}
        </div>
        <div className="media-picker-controls">
          <select id={selectId} value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">ไม่ใช้รูป</option>
            {media.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {selected && (
            <button type="button" className="button button-glass button-small" onClick={() => onChange("")}>
              นำรูปออก
            </button>
          )}
          {hint && <small>{hint}</small>}
          {media.length === 0 && (
            <small>
              ยังไม่มีรูปที่เลือกได้ — ต้องเป็นรูปที่เผยแพร่แล้ว เป็นสาธารณะ และมีไฟล์ JPG หรือ PNG
            </small>
          )}
        </div>
      </div>
    </div>
  );
}
