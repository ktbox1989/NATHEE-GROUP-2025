/**
 * Editor-facing outcomes for the CMS routes.
 *
 * The pages previously printed the raw code ("ไม่สำเร็จ: publish_failed"), which
 * is fine for a code an editor can act on and useless for one they cannot. The
 * publish contract now refuses a revision whose media a reader could not be
 * served, and that refusal is only useful if it says which reference is the
 * problem.
 */

const ERROR_MESSAGES: Record<string, string> = {
  invalid_content: "เนื้อหาไม่ถูกต้อง กรุณาตรวจหัวข้อ คำอธิบาย และลิงก์ของแต่ละ Section",
  invalid_page: "ไม่พบหน้านี้ในระบบ CMS",
  invalid_publish: "คำสั่งเผยแพร่ไม่ถูกต้อง",
  page_not_saved: "ต้องบันทึก Revision อย่างน้อยหนึ่งฉบับก่อนเผยแพร่",
  revision_not_found: "ไม่พบ Revision ที่เลือก",
  revision_unreadable: "Revision นี้อ่านไม่ได้ กรุณาบันทึกฉบับใหม่ก่อนเผยแพร่",
  save_failed: "บันทึกไม่สำเร็จ กรุณาลองใหม่",
  publish_failed: "เผยแพร่ไม่สำเร็จ กรุณาลองใหม่",
  unpublishable_media: "ยังเผยแพร่ไม่ได้ เพราะมีภาพหรือหมวด Gallery ที่ผู้เข้าชมจะมองไม่เห็น",
  forbidden: "บัญชีนี้ไม่มีสิทธิ์ดำเนินการนี้",
  invalid_settings: "การตั้งค่าไม่ผ่านการตรวจ กรุณาตรวจอีเมล ที่อยู่ LINE ID และเบอร์โทรอีกครั้ง",
  // The publish route refuses this rather than the save route, so an editor can
  // reach it with a revision already stored. The message says what to do next.
  home_cannot_be_noindex: "หน้าแรกตั้งเป็น NOINDEX ไม่ได้ เพราะทุกหน้าลิงก์กลับมาที่หน้าแรก กรุณาเปลี่ยนเป็น INDEX แล้วบันทึก Revision ใหม่ก่อนเผยแพร่",
};

const MISSING_REFERENCE = /^(image|category):([A-Za-z0-9_-]{1,80})$/;

/**
 * The failing reference, read back from the URL. Validated on read rather than
 * trusted: the query string is caller-controlled even though this application
 * wrote it.
 */
export function parseMissingReference(value: string | undefined): { kind: "image" | "category"; id: string } | null {
  const match = value ? MISSING_REFERENCE.exec(value) : null;
  return match ? { kind: match[1] as "image" | "category", id: match[2] } : null;
}

export function cmsErrorMessage(code: string | undefined, missing?: string): string | null {
  if (!code) return null;
  const base = ERROR_MESSAGES[code] ?? `ไม่สำเร็จ: ${code.slice(0, 60).replace(/[^A-Za-z0-9_-]/g, "")}`;
  const reference = parseMissingReference(missing);
  if (!reference) return base;
  const label = reference.kind === "image" ? "ภาพ" : "หมวด Gallery";
  return `${base} (${label}: ${reference.id})`;
}
