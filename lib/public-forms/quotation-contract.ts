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

export type QuotationField =
  | "contactName"
  | "phone"
  | "email"
  | "origin"
  | "destination"
  | "motorcycleCount"
  | "details"
  | "consent";

export type FieldError = { field: QuotationField; message: string };

export type QuotationDraft = {
  contactName: string;
  phone: string;
  email: string;
  origin: string;
  destination: string;
  motorcycleCount: string;
  details: string;
  consent: boolean;
};

// Mirrors the bounds the server enforces. Kept generous: rejecting a real
// enquiry loses a customer, and the server is the authority regardless.
const LIMITS = {
  contactName: { min: 2, max: 120 },
  origin: { min: 2, max: 200 },
  destination: { min: 2, max: 200 },
  details: { min: 0, max: 2000 },
  motorcycleCount: { min: 1, max: 500 },
} as const;

// Thai mobile and landline numbers, with or without separators, optionally in
// +66 form. Deliberately permissive about spacing and dashes.
const THAI_PHONE = /^(?:\+?66|0)\d{8,9}$/;
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function normalisePhone(value: string): string {
  return value.replace(/[\s()-]/g, "");
}

/**
 * Validates a draft for the person typing it. Returns every problem at once so
 * the form can show them together rather than one per submission.
 */
export function validateQuotationDraft(draft: QuotationDraft): FieldError[] {
  const errors: FieldError[] = [];
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

  const name = text(draft.contactName);
  if (name.length < LIMITS.contactName.min || name.length > LIMITS.contactName.max) {
    errors.push({ field: "contactName", message: "กรุณากรอกชื่อผู้ติดต่อ" });
  }

  const phone = normalisePhone(text(draft.phone));
  if (!THAI_PHONE.test(phone)) {
    errors.push({ field: "phone", message: "กรุณากรอกเบอร์โทรศัพท์ที่ติดต่อได้" });
  }

  // Email is optional; an invalid one is still worth catching before submit.
  const email = text(draft.email);
  if (email.length > 0 && (email.length > 254 || !EMAIL.test(email))) {
    errors.push({ field: "email", message: "รูปแบบอีเมลไม่ถูกต้อง" });
  }

  for (const field of ["origin", "destination"] as const) {
    const value = text(draft[field]);
    if (value.length < LIMITS[field].min || value.length > LIMITS[field].max) {
      errors.push({
        field,
        message: field === "origin" ? "กรุณาระบุต้นทาง" : "กรุณาระบุปลายทาง",
      });
    }
  }

  const count = Number(text(draft.motorcycleCount));
  if (
    !Number.isInteger(count) ||
    count < LIMITS.motorcycleCount.min ||
    count > LIMITS.motorcycleCount.max
  ) {
    errors.push({ field: "motorcycleCount", message: "กรุณาระบุจำนวนรถเป็นตัวเลข 1-500" });
  }

  if (text(draft.details).length > LIMITS.details.max) {
    errors.push({ field: "details", message: "รายละเอียดยาวเกินกำหนด" });
  }

  // Consent is a legal requirement for storing the enquiry, not a preference.
  if (draft.consent !== true) {
    errors.push({ field: "consent", message: "กรุณายอมรับการเก็บข้อมูลเพื่อติดต่อกลับ" });
  }

  return errors;
}

// --- submission state ------------------------------------------------------

export type SubmissionState =
  | { status: "IDLE" }
  | { status: "INVALID"; errors: FieldError[] }
  | { status: "SUBMITTING"; requestKey: string }
  | { status: "SUCCESS"; reference: string; requestKey: string }
  | { status: "ERROR"; message: string; requestKey: string; retryable: boolean };

/**
 * The response the frontend requires before it may claim success.
 *
 * Anything less — an HTML page, a bare 200, a redirect that happened to
 * resolve, a body missing the reference — is treated as failure. A customer
 * told their request was received when it was not will simply wait, and the
 * enquiry is lost silently.
 */
export type QuotationAcknowledgement = {
  ok: true;
  reference: string;
  requestKey: string;
};

export function parseAcknowledgement(
  payload: unknown,
  expectedRequestKey: string,
): { ok: true; value: QuotationAcknowledgement } | { ok: false; reason: string } {
  if (typeof payload !== "object" || payload === null) return { ok: false, reason: "response was not an object" };
  const body = payload as Partial<QuotationAcknowledgement>;

  if (body.ok !== true) return { ok: false, reason: "server did not acknowledge the request" };
  if (typeof body.reference !== "string" || body.reference.trim().length === 0) {
    return { ok: false, reason: "server returned no reference number" };
  }
  if (body.requestKey !== expectedRequestKey) {
    // A mismatched key means this is not the answer to this submission, so it
    // must not be reported as one.
    return { ok: false, reason: "server acknowledged a different request" };
  }
  return { ok: true, value: { ok: true, reference: body.reference, requestKey: body.requestKey } };
}

/**
 * One cryptographically random key per enquiry, kept across retries so a
 * network failure followed by a retry cannot create a second request.
 */
export function createRequestKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type SubmitOutcome = {
  httpStatus: number;
  payload: unknown;
};

/**
 * Decides the state after an attempt. Success requires a complete, matching
 * acknowledgement; everything else is an error the customer can act on.
 */
export function reduceSubmission(outcome: SubmitOutcome, requestKey: string): SubmissionState {
  const { httpStatus, payload } = outcome;

  if (httpStatus === 200 || httpStatus === 201) {
    const parsed = parseAcknowledgement(payload, requestKey);
    if (parsed.ok) return { status: "SUCCESS", reference: parsed.value.reference, requestKey };
    // A 200 that does not carry the contract is not a success.
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
  if (httpStatus >= 500 || httpStatus === 0) {
    return { status: "ERROR", message: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่หรือโทรติดต่อทีมงาน", requestKey, retryable: true };
  }
  if (httpStatus === 400 || httpStatus === 422) {
    return { status: "ERROR", message: "ข้อมูลไม่ครบหรือไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง", requestKey, retryable: false };
  }
  if (httpStatus === 403) {
    return { status: "ERROR", message: "ไม่สามารถยืนยันคำขอได้ กรุณาลองใหม่", requestKey, retryable: true };
  }

  return { status: "ERROR", message: "ส่งคำขอไม่สำเร็จ กรุณาโทรติดต่อทีมงาน", requestKey, retryable: true };
}

/**
 * The telephone numbers stay visible whatever the form does. If the endpoint
 * is unavailable the customer must still have a way to reach the company.
 */
export const VERIFIED_CONTACT_NUMBERS = ["063-194-1191", "085-680-2082"] as const;

export function shouldOfferTelephoneFallback(state: SubmissionState): boolean {
  return state.status === "ERROR" || state.status === "IDLE";
}
