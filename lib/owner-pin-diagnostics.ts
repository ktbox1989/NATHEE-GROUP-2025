export const OWNER_PIN_STAGES = ["throttle", "verify", "bootstrap"] as const;

export type OwnerPinStage = (typeof OWNER_PIN_STAGES)[number];

export type OwnerPinStageDiagnostic = {
  OWNER_PIN_STAGE: OwnerPinStage;
  exception_class: string;
  exception_message: string;
  request_correlation_id: string;
};

type HeaderReader = Pick<Headers, "get">;

const CORRELATION_HEADERS = ["cf-ray", "x-request-id"] as const;
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_EXCEPTION_CLASS = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const MAX_EXCEPTION_MESSAGE = 240;

function exceptionClass(error: unknown): string {
  if (!(error instanceof Error)) return "UnknownError";
  return SAFE_EXCEPTION_CLASS.test(error.name) ? error.name : "Error";
}

function safeExceptionMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Non-Error rejection";
  const message = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\$pbkdf2-sha256\$[^\s]+/gi, "[redacted-credential]")
    .replace(/\b(OWNER_(?:PIN_CREDENTIAL|SESSION_SECRET))\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\b(nathee_owner_session)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\bpin\s*[:=]\s*\d{6}\b/gi, "PIN=[redacted]")
    .replace(/\bowner-pin:kaikt143@gmail\.com\b/gi, "[canonical-owner]")
    .replace(/\bkaikt143@gmail\.com\b/gi, "[canonical-owner]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[redacted-token]")
    .slice(0, MAX_EXCEPTION_MESSAGE);
  return message || "No safe exception message";
}

function requestCorrelationId(headers: HeaderReader): string {
  for (const header of CORRELATION_HEADERS) {
    const candidate = headers.get(header)?.trim();
    if (candidate && SAFE_CORRELATION_ID.test(candidate)) return candidate;
  }
  return "not-provided";
}

export function ownerPinStageDiagnostic(
  stage: OwnerPinStage,
  error: unknown,
  headers: HeaderReader,
): OwnerPinStageDiagnostic {
  return {
    OWNER_PIN_STAGE: stage,
    exception_class: exceptionClass(error),
    exception_message: safeExceptionMessage(error),
    request_correlation_id: requestCorrelationId(headers),
  };
}

export function logOwnerPinStageFailure(
  stage: OwnerPinStage,
  error: unknown,
  headers: HeaderReader,
): void {
  console.error(JSON.stringify(ownerPinStageDiagnostic(stage, error, headers)));
}
