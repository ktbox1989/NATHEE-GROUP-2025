// Frontend contract for the public quotation form.
//
// Lane B owns the endpoint, the database and the anti-abuse verification. This
// file owns what the browser sends, what it will accept back, and — the part
// that matters most — when it is allowed to tell a customer their request was
// received.
//
// Client validation here is a courtesy to the person filling the form, not a
// security boundary. The server re-validates everything; nothing in this file
// may be treated as trusted by anything server-side.
//
// ---------------------------------------------------------------------------
// Reconciled field by field against Lane B's live endpoint
// (`app/api/quotation/route.ts` + `lib/quotation.ts`) at main 74d88b4. The
// earlier version of this file described a plausible JSON API that Lane B does
// not implement, so an enabled form would have failed on every submission.
// Four differences were real and are handled here rather than smoothed over;
// they are written up in docs/QUOTATION_BACKEND.md.
//
//   1. The request key. Lane B requires `quote-<uuid v4>` and slices the
//      prefix off to use as the Turnstile idempotency key. This file used to
//      emit 32 bare hex characters, which B rejects as `invalid` before it
//      reaches D1 — silently, because the rejection looks exactly like a
//      validation failure. `createRequestKey` now emits B's format, and
//      `isWireRequestKey` states the rule so it cannot drift again.
//   2. The response. Lane B answers a successful POST with a **303 redirect**
//      to `/quotation?submitted=<QT-YYYY-NNNNNN>`, not a JSON body. There is
//      no acknowledgement object and no echoed request key, so success is
//      recognised from the redirect target of this POST's own response chain.
//   3. The field set. B accepts company, LINE id, vehicle type, desired date
//      and service extras, and the bounds differ from the ones assumed here.
//      B truncates over-long values with `slice()` rather than rejecting them,
//      so a client bound looser than B's silently loses the tail of what the
//      customer typed. Every bound below now mirrors B exactly.
//   4. New/used condition is **not expressible**. B has no column for it, and
//      an unknown form field is discarded without comment. Collecting it would
//      show the customer a question whose answer is thrown away, so it is not
//      collected; see `UNMAPPABLE_QUOTATION_FIELDS`.

// --- what Lane B accepts ---------------------------------------------------

// Mirrors QUOTATION_VEHICLE_TYPES in lib/quotation.ts. A value outside this set
// makes B reject the whole submission.
export const QUOTATION_VEHICLE_TYPES = ["MOTORCYCLE", "BIG_BIKE", "MIXED", "OTHER"] as const;
export type QuotationVehicleType = (typeof QUOTATION_VEHICLE_TYPES)[number];

// Mirrors QUOTATION_EXTRAS. These are the storage / container / export /
// large-batch services the enquiry can ask for.
export const QUOTATION_EXTRAS = ["STORAGE", "CONTAINER", "INTERNATIONAL", "LARGE_BATCH"] as const;
export type QuotationExtra = (typeof QUOTATION_EXTRAS)[number];

/**
 * Questions the public form must NOT ask, because Lane B has nowhere to put the
 * answer. Exported so the omission is a stated, tested decision rather than an
 * oversight someone "fixes" by adding an input that goes nowhere.
 */
export const UNMAPPABLE_QUOTATION_FIELDS: ReadonlyArray<{ field: string; reason: string }> = Object.freeze([
  Object.freeze({
    field: "condition",
    reason:
      "new/used has no column in quote_requests and no field in parseQuotationForm; " +
      "Lane B must add one before the form may ask",
  }),
]);

export type QuotationField =
  | "companyName"
  | "contactName"
  | "phone"
  | "lineId"
  | "email"
  | "origin"
  | "destination"
  | "quantity"
  | "vehicleType"
  | "desiredDate"
  | "extras"
  | "notes"
  | "consent"
  | "attachments";

export type FieldError = { field: QuotationField; message: string };

export type QuotationDraft = {
  /** Optional. Blank for a private customer. */
  companyName: string;
  contactName: string;
  phone: string;
  /** Optional. Many customers here prefer LINE to email. */
  lineId: string;
  /** Optional, but must be well formed when given. */
  email: string;
  /** Pickup. */
  origin: string;
  /** Delivery. */
  destination: string;
  /** Kept as the raw string the input holds, so "1.5" and "" stay reportable. */
  quantity: string;
  vehicleType: QuotationVehicleType | "";
  /** Optional ISO yyyy-mm-dd. */
  desiredDate: string;
  extras: QuotationExtra[];
  notes: string;
  consent: boolean;
};

// Exactly Lane B's bounds. Looser here would mean B truncates what the customer
// typed; tighter would mean this form refuses an enquiry B would have accepted.
// Both lose business, so neither is left to chance.
export const QUOTATION_LIMITS = Object.freeze({
  companyName: Object.freeze({ max: 160 }),
  contactName: Object.freeze({ min: 2, max: 120 }),
  phone: Object.freeze({ max: 30 }),
  lineId: Object.freeze({ max: 100 }),
  email: Object.freeze({ max: 254 }),
  origin: Object.freeze({ min: 2, max: 180 }),
  destination: Object.freeze({ min: 2, max: 180 }),
  quantity: Object.freeze({ min: 1, max: 10_000 }),
  notes: Object.freeze({ max: 1500 }),
});

// Mirrors lib/quotation-attachments.ts.
export const QUOTATION_ATTACHMENT_LIMITS = Object.freeze({
  maxCount: 5,
  maxBytesEach: 8 * 1024 * 1024,
  maxBytesTotal: 20 * 1024 * 1024,
  // Spreadsheet and CSV are accepted so a dealer can attach a vehicle list
  // rather than retyping it into the notes field.
  extensions: Object.freeze(["jpg", "jpeg", "png", "webp", "avif", "heic", "heif", "pdf", "csv", "xlsx"]),
});

// Thai mobile and landline numbers, with or without separators, optionally in
// +66 form. Deliberately permissive about spacing and dashes.
const THAI_PHONE = /^(?:\+?66|0)\d{8,9}$/;
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function normalisePhone(value: string): string {
  return value.replace(/[\s()-]/g, "");
}

/** The ISO date shape B accepts, checked as a real calendar date. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Validates a draft for the person typing it. Returns every problem at once so
 * the form can show them together rather than one per submission.
 */
export function validateQuotationDraft(draft: QuotationDraft): FieldError[] {
  const errors: FieldError[] = [];
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

  const company = text(draft.companyName);
  if (company.length > QUOTATION_LIMITS.companyName.max) {
    errors.push({ field: "companyName", message: "ชื่อบริษัทยาวเกินกำหนด" });
  }

  const name = text(draft.contactName);
  if (name.length < QUOTATION_LIMITS.contactName.min || name.length > QUOTATION_LIMITS.contactName.max) {
    errors.push({ field: "contactName", message: "กรุณากรอกชื่อผู้ติดต่อ" });
  }

  const rawPhone = text(draft.phone);
  const phone = normalisePhone(rawPhone);
  if (rawPhone.length > QUOTATION_LIMITS.phone.max || !THAI_PHONE.test(phone)) {
    errors.push({ field: "phone", message: "กรุณากรอกเบอร์โทรศัพท์ที่ติดต่อได้" });
  }

  const lineId = text(draft.lineId);
  if (lineId.length > QUOTATION_LIMITS.lineId.max) {
    errors.push({ field: "lineId", message: "LINE ID ยาวเกินกำหนด" });
  }

  const email = text(draft.email);
  if (email && (email.length > QUOTATION_LIMITS.email.max || !EMAIL.test(email))) {
    errors.push({ field: "email", message: "กรุณาตรวจสอบอีเมล" });
  }

  const origin = text(draft.origin);
  if (origin.length < QUOTATION_LIMITS.origin.min || origin.length > QUOTATION_LIMITS.origin.max) {
    errors.push({ field: "origin", message: "กรุณาระบุจุดรับรถ" });
  }

  const destination = text(draft.destination);
  if (destination.length < QUOTATION_LIMITS.destination.min || destination.length > QUOTATION_LIMITS.destination.max) {
    errors.push({ field: "destination", message: "กรุณาระบุจุดส่งรถ" });
  }

  const quantity = Number(text(draft.quantity));
  if (
    !Number.isSafeInteger(quantity) ||
    quantity < QUOTATION_LIMITS.quantity.min ||
    quantity > QUOTATION_LIMITS.quantity.max
  ) {
    errors.push({ field: "quantity", message: "กรุณากรอกจำนวนรถเป็นตัวเลขจำนวนเต็ม" });
  }

  if (!QUOTATION_VEHICLE_TYPES.includes(draft.vehicleType as QuotationVehicleType)) {
    errors.push({ field: "vehicleType", message: "กรุณาเลือกประเภทรถ" });
  }

  const desiredDate = text(draft.desiredDate);
  if (desiredDate && !isIsoDate(desiredDate)) {
    errors.push({ field: "desiredDate", message: "กรุณาตรวจสอบวันที่ต้องการ" });
  }

  if (!Array.isArray(draft.extras) || draft.extras.some((extra) => !QUOTATION_EXTRAS.includes(extra))) {
    errors.push({ field: "extras", message: "บริการเพิ่มเติมไม่ถูกต้อง" });
  }

  const notes = text(draft.notes);
  if (notes.length > QUOTATION_LIMITS.notes.max) {
    // B would silently truncate, so the customer is told here instead of
    // discovering later that the end of their message was never delivered.
    errors.push({ field: "notes", message: `รายละเอียดเพิ่มเติมยาวเกิน ${QUOTATION_LIMITS.notes.max} ตัวอักษร` });
  }

  // Consent is a legal requirement for storing the enquiry, not a preference.
  if (draft.consent !== true) {
    errors.push({ field: "consent", message: "กรุณายอมรับการเก็บข้อมูลเพื่อติดต่อกลับ" });
  }

  return errors;
}

/**
 * Client-side check of the files chosen, mirroring the server's count, size and
 * type limits. The server re-checks every one of these and additionally reads
 * the file signature, which the browser cannot be trusted to do — this exists
 * only so a customer learns about a 30 MB photo before uploading it.
 */
export function validateQuotationAttachments(
  files: ReadonlyArray<{ name: string; size: number }>,
): FieldError[] {
  const errors: FieldError[] = [];
  if (files.length > QUOTATION_ATTACHMENT_LIMITS.maxCount) {
    errors.push({ field: "attachments", message: `แนบไฟล์ได้สูงสุด ${QUOTATION_ATTACHMENT_LIMITS.maxCount} ไฟล์` });
  }
  if (files.some((file) => file.size > QUOTATION_ATTACHMENT_LIMITS.maxBytesEach)) {
    errors.push({ field: "attachments", message: "แต่ละไฟล์ต้องไม่เกิน 8 MB" });
  }
  if (files.reduce((total, file) => total + file.size, 0) > QUOTATION_ATTACHMENT_LIMITS.maxBytesTotal) {
    errors.push({ field: "attachments", message: "ไฟล์แนบรวมกันต้องไม่เกิน 20 MB" });
  }
  if (files.some((file) => !QUOTATION_ATTACHMENT_LIMITS.extensions.includes(extensionOf(file.name)))) {
    errors.push({ field: "attachments", message: "รองรับเฉพาะรูปภาพ PDF CSV และ XLSX" });
  }
  return errors;
}

function extensionOf(filename: string): string {
  return filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

// --- the wire format -------------------------------------------------------

/**
 * Lane B parses `quote-<uuid v4>` and slices the `quote-` prefix off to use as
 * the Turnstile idempotency key, so the prefix is load-bearing rather than
 * decorative. Anything else is rejected as `invalid` before reaching D1.
 */
const WIRE_REQUEST_KEY = /^quote-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isWireRequestKey(value: string): boolean {
  return WIRE_REQUEST_KEY.test(value);
}

/**
 * One key per enquiry, kept across retries so a network failure followed by a
 * retry cannot create a second request: Lane B looks the key up first and
 * returns the original request number rather than storing a duplicate.
 */
export function createRequestKey(): string {
  return `quote-${crypto.randomUUID()}`;
}

/**
 * The exact multipart body Lane B's parser reads. Field names are B's, not this
 * module's, which is why the mapping is written out here in one place instead
 * of being spread across a form template.
 *
 * `website` is B's honeypot: it must be present and empty. `privacyConsent`
 * must be the literal "yes" — a boolean or "true" is refused as missing
 * consent.
 */
export function buildQuotationFormData(
  draft: QuotationDraft,
  requestKey: string,
  options: { turnstileToken?: string; attachments?: ReadonlyArray<File> } = {},
): FormData {
  if (!isWireRequestKey(requestKey)) {
    // Failing here is much cheaper than a server rejection the customer sees
    // as "ข้อมูลไม่ครบหรือไม่ถูกต้อง" with nothing wrong on their form.
    throw new Error("request key must be quote-<uuid v4>");
  }

  const form = new FormData();
  const trimmed = (value: string, max: number) => value.trim().slice(0, max);

  form.set("requestKey", requestKey);
  form.set("companyName", trimmed(draft.companyName, QUOTATION_LIMITS.companyName.max));
  form.set("contactName", trimmed(draft.contactName, QUOTATION_LIMITS.contactName.max));
  form.set("phone", trimmed(draft.phone, QUOTATION_LIMITS.phone.max));
  form.set("lineId", trimmed(draft.lineId, QUOTATION_LIMITS.lineId.max));
  form.set("email", trimmed(draft.email, QUOTATION_LIMITS.email.max));
  form.set("origin", trimmed(draft.origin, QUOTATION_LIMITS.origin.max));
  form.set("destination", trimmed(draft.destination, QUOTATION_LIMITS.destination.max));
  form.set("quantity", draft.quantity.trim());
  form.set("vehicleType", draft.vehicleType);
  form.set("desiredDate", draft.desiredDate.trim());
  form.set("notes", trimmed(draft.notes, QUOTATION_LIMITS.notes.max));
  // B reads extras with getAll and de-duplicates, so repeated entries are the
  // wire form rather than a comma-separated string.
  for (const extra of [...new Set(draft.extras)]) form.append("extras", extra);
  form.set("privacyConsent", draft.consent ? "yes" : "no");
  form.set("website", "");
  if (options.turnstileToken) form.set("cf-turnstile-response", options.turnstileToken);
  for (const file of options.attachments ?? []) form.append("attachments", file);

  return form;
}

// --- submission state ------------------------------------------------------

export type SubmissionState =
  | { status: "IDLE" }
  | { status: "INVALID"; errors: FieldError[] }
  | { status: "SUBMITTING"; requestKey: string }
  | { status: "SUCCESS"; reference: string; requestKey: string }
  | { status: "ERROR"; message: string; requestKey: string; retryable: boolean };

/** The business number B allocates from D1: `QT-YYYY-NNNNNN`. */
const REFERENCE_NUMBER = /^QT-\d{4}-\d{6}$/;

export function isQuotationReference(value: string): boolean {
  return REFERENCE_NUMBER.test(value);
}

/**
 * Lane B's failure codes, carried in `?error=`. Each one is answered with
 * something the customer can act on; a code this file does not know is treated
 * as a generic failure rather than mistaken for anything else.
 */
const SERVER_ERROR_MESSAGES: Readonly<Record<string, { message: string; retryable: boolean }>> = Object.freeze({
  invalid: { message: "ข้อมูลไม่ครบหรือไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง", retryable: false },
  consent: { message: "กรุณายอมรับการเก็บข้อมูลเพื่อติดต่อกลับ", retryable: false },
  // The honeypot fired. A real customer never sees this, but if one somehow
  // does, the telephone route must still be offered rather than a dead end.
  bot: { message: "ไม่สามารถยืนยันคำขอได้ กรุณาโทรติดต่อทีมงาน", retryable: false },
  challenge: { message: "ไม่สามารถยืนยันคำขอได้ กรุณาลองใหม่", retryable: true },
  file_count: { message: "แนบไฟล์ได้สูงสุด 5 ไฟล์", retryable: false },
  file_size: { message: "ไฟล์แนบมีขนาดใหญ่เกินกำหนด", retryable: false },
  file_type: { message: "รองรับเฉพาะรูปภาพ PDF CSV และ XLSX", retryable: false },
  file_name: { message: "ชื่อไฟล์แนบไม่ถูกต้อง", retryable: false },
  save: { message: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่หรือโทรติดต่อทีมงาน", retryable: true },
  cleanup: { message: "ระบบขัดข้องชั่วคราว กรุณาโทรติดต่อทีมงาน", retryable: false },
});

/**
 * Every failure code this contract answers by name. Exported so a gate can
 * compare it against the codes the endpoint can actually emit: a code the
 * server adds and this file has never heard of degrades to a generic retry
 * message, which is safe but unhelpful, and the drift should be visible.
 */
export const QUOTATION_SERVER_ERROR_CODES: ReadonlyArray<string> = Object.freeze(
  Object.keys(SERVER_ERROR_MESSAGES).sort(),
);

/**
 * What the browser observed after POSTing the form.
 *
 * `finalUrl` is `response.url` when redirects were followed, or the `Location`
 * header when they were not. It must come from THIS submission's response — a
 * `?submitted=` parameter read off the address bar is attacker-supplied and
 * proves nothing.
 */
export type SubmitOutcome = {
  httpStatus: number;
  finalUrl: string | null;
  contentType?: string | null;
};

function readOutcomeUrl(finalUrl: string | null): URL | null {
  if (!finalUrl) return null;
  try {
    // A relative Location is normal; the base only has to be syntactically
    // valid because nothing here depends on the origin.
    return new URL(finalUrl, "https://app.natheegroup2025.com");
  } catch {
    return null;
  }
}

/**
 * Decides the state after an attempt.
 *
 * Success requires Lane B's redirect to carry a real request number. A bare
 * 200, an HTML page, a redirect with no `submitted` parameter, or a reference
 * that is not a business number are all failures — a customer told their
 * enquiry was received when it was not will simply wait, and the enquiry is
 * lost silently.
 *
 * There is no echoed request key to match against, because B does not return
 * one. The binding is the response chain: this is the answer to this POST.
 */
export function reduceSubmission(outcome: SubmitOutcome, requestKey: string): SubmissionState {
  const { httpStatus } = outcome;
  const url = readOutcomeUrl(outcome.finalUrl);

  const submitted = url?.searchParams.get("submitted");
  const serverError = url?.searchParams.get("error");

  // An explicit failure is answered before anything else, so a URL carrying
  // both parameters can never be read as a success.
  if (serverError) {
    const known = SERVER_ERROR_MESSAGES[serverError];
    return {
      status: "ERROR",
      message: known?.message ?? "ส่งคำขอไม่สำเร็จ กรุณาโทรติดต่อทีมงาน",
      requestKey,
      retryable: known?.retryable ?? true,
    };
  }

  if (submitted !== null && submitted !== undefined) {
    if (isQuotationReference(submitted.trim())) {
      return { status: "SUCCESS", reference: submitted.trim(), requestKey };
    }
    // A `submitted` parameter that is not a business number means something
    // rewrote the URL. It is not evidence that anything was stored.
    return {
      status: "ERROR",
      message: "ระบบยังไม่ยืนยันการรับคำขอ กรุณาลองใหม่หรือโทรติดต่อทีมงาน",
      requestKey,
      retryable: true,
    };
  }

  if (httpStatus === 429) {
    return { status: "ERROR", message: "มีคำขอเข้ามามาก กรุณารอสักครู่แล้วลองใหม่", requestKey, retryable: true };
  }
  if (httpStatus === 403) {
    // B answers a cross-origin POST with a bare 403. The form must be served
    // from the application origin; see the origin note in the documentation.
    return { status: "ERROR", message: "ไม่สามารถยืนยันคำขอได้ กรุณาลองใหม่", requestKey, retryable: true };
  }
  if (httpStatus >= 500 || httpStatus === 0) {
    return { status: "ERROR", message: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่หรือโทรติดต่อทีมงาน", requestKey, retryable: true };
  }

  // Everything left is a response that did not carry the contract: a 200 HTML
  // page, an empty body, a redirect somewhere else. None of them mean stored.
  return {
    status: "ERROR",
    message: "ระบบยังไม่ยืนยันการรับคำขอ กรุณาลองใหม่หรือโทรติดต่อทีมงาน",
    requestKey,
    retryable: true,
  };
}

/**
 * The telephone numbers stay visible whatever the form does. If the endpoint
 * is unavailable the customer must still have a way to reach the company.
 */
export const VERIFIED_CONTACT_NUMBERS = ["063-194-1191", "085-680-2082"] as const;

export function shouldOfferTelephoneFallback(state: SubmissionState): boolean {
  return state.status === "ERROR" || state.status === "IDLE";
}

/**
 * Lane B answers a cross-origin POST with 403 before parsing anything, so the
 * quotation form has to be served from the application origin. Hosting it on
 * the public apex and posting across would fail every time, which is a
 * deployment decision rather than a form detail — stated here because this is
 * the file someone reads when wiring the form up.
 */
export const QUOTATION_ENDPOINT_REQUIRES_APP_ORIGIN = true;

// --- what the person filling the form actually sees ---------------------------

/**
 * How an attachment is described back to the customer before they submit.
 *
 * `validateQuotationAttachments` answers "is this set acceptable", which is the
 * right question for the submit button and the wrong one for the file list: a
 * customer who attached five photographs and one 30 MB video is told the set is
 * too large and left to work out which file to remove. Every problem here is
 * therefore attributed to the file that caused it.
 */
export type AttachmentKind = "IMAGE" | "PDF" | "SPREADSHEET" | "OTHER";

export type AttachmentPreview = {
  name: string;
  byteSize: number;
  sizeLabel: string;
  kind: AttachmentKind;
  /** Only an image can be shown as a thumbnail; the rest get a name and an icon. */
  previewable: boolean;
  /** The problem with this file, or null. */
  error: string | null;
};

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif", "heic", "heif"];

export function attachmentKindOf(filename: string): AttachmentKind {
  const extension = extensionOf(filename);
  if (IMAGE_EXTENSIONS.includes(extension)) return "IMAGE";
  if (extension === "pdf") return "PDF";
  if (extension === "csv" || extension === "xlsx") return "SPREADSHEET";
  return "OTHER";
}

/** Bytes as a person reads them. Thai and English both use these units. */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type AttachmentSummary = {
  previews: AttachmentPreview[];
  totalBytes: number;
  totalLabel: string;
  /** Problems with the set rather than with one file. */
  setErrors: string[];
  /** True when every file is acceptable and the set is within its limits. */
  acceptable: boolean;
};

/**
 * Describes the chosen files for the list beside the form.
 *
 * HEIC is worth a note: iPhones produce it by default, the server accepts it,
 * and no browser will render a thumbnail of one. Marking it un-previewable
 * rather than rendering a broken image is the difference between "my photo did
 * not attach" and "my photo attached and has no preview".
 */
export function describeAttachments(
  files: ReadonlyArray<{ name: string; size: number }>,
): AttachmentSummary {
  const previews: AttachmentPreview[] = files.map((file) => {
    const kind = attachmentKindOf(file.name);
    const extension = extensionOf(file.name);
    let error: string | null = null;

    if (!QUOTATION_ATTACHMENT_LIMITS.extensions.includes(extension)) {
      error = "รองรับเฉพาะรูปภาพ PDF CSV และ XLSX";
    } else if (file.size > QUOTATION_ATTACHMENT_LIMITS.maxBytesEach) {
      error = `ไฟล์นี้ ${formatByteSize(file.size)} เกิน 8 MB`;
    } else if (file.size === 0) {
      // A zero-byte file is silently dropped by the server's filter, so the
      // customer would believe they attached something that never arrived.
      error = "ไฟล์นี้ว่างเปล่า";
    }

    return {
      name: file.name,
      byteSize: file.size,
      sizeLabel: formatByteSize(file.size),
      kind,
      // HEIC and HEIF are accepted by the server and rendered by no browser.
      previewable: kind === "IMAGE" && !["heic", "heif"].includes(extension),
      error,
    };
  });

  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  const setErrors: string[] = [];
  if (files.length > QUOTATION_ATTACHMENT_LIMITS.maxCount) {
    setErrors.push(`แนบไฟล์ได้สูงสุด ${QUOTATION_ATTACHMENT_LIMITS.maxCount} ไฟล์`);
  }
  if (totalBytes > QUOTATION_ATTACHMENT_LIMITS.maxBytesTotal) {
    setErrors.push(`ไฟล์แนบรวม ${formatByteSize(totalBytes)} เกิน 20 MB`);
  }
  // The server refuses two identical files, so saying so here saves a
  // submission that would be rejected for a reason nobody would guess.
  const names = files.map((file) => file.name.toLowerCase());
  if (new Set(names).size !== names.length) setErrors.push("มีไฟล์ชื่อซ้ำกัน");

  return {
    previews,
    totalBytes,
    totalLabel: formatByteSize(totalBytes),
    setErrors,
    acceptable: setErrors.length === 0 && previews.every((preview) => preview.error === null),
  };
}

// --- submitting once, and only once -------------------------------------------

/**
 * Whether the submit button may do anything.
 *
 * False while a submission is in flight and false after one has succeeded. A
 * double tap on a phone is not a rare event, and every extra submission with a
 * fresh key would be a second enquiry in the Owner's inbox for one customer.
 * The request key protects the database; this protects the person.
 */
export function canSubmit(state: SubmissionState): boolean {
  return state.status !== "SUBMITTING" && state.status !== "SUCCESS";
}

/**
 * Whether a failed submission may be retried, and with which key.
 *
 * A retry reuses the original key so the server recognises it and returns the
 * request number it already stored, rather than creating a second enquiry. A
 * validation failure is not retryable as-is: the form has to change first.
 */
export function retryPlan(state: SubmissionState): { retryable: boolean; requestKey: string | null } {
  if (state.status !== "ERROR") return { retryable: false, requestKey: null };
  return { retryable: state.retryable, requestKey: state.retryable ? state.requestKey : null };
}

export type SubmissionProgress = {
  /** 0–100, or null when the total is not yet known. */
  percent: number | null;
  label: string;
  /** True while the browser is still sending bytes. */
  busy: boolean;
};

/**
 * What the form says while it is working.
 *
 * A quotation with 20 MB of photographs attached takes long enough on a mobile
 * connection that a spinner with no number reads as a hang, and the customer
 * submits again. Reporting real progress is what stops that.
 */
export function describeProgress(
  state: SubmissionState,
  uploaded = 0,
  total = 0,
): SubmissionProgress {
  if (state.status !== "SUBMITTING") {
    if (state.status === "SUCCESS") return { percent: 100, label: "ส่งคำขอเรียบร้อย", busy: false };
    return { percent: null, label: "", busy: false };
  }
  if (!Number.isFinite(total) || total <= 0) {
    return { percent: null, label: "กำลังส่งคำขอ…", busy: true };
  }
  const percent = Math.max(0, Math.min(100, Math.round((uploaded / total) * 100)));
  // 100% before the server has answered is a lie the customer will notice, so
  // the bar stops just short until the acknowledgement arrives.
  const shown = percent >= 100 ? 99 : percent;
  return {
    percent: shown,
    label: shown >= 99 ? "กำลังรอการยืนยันจากระบบ…" : `กำลังอัปโหลด ${shown}%`,
    busy: true,
  };
}
