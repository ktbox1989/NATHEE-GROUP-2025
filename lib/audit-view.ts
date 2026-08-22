import { AUTH_EVENT_ACTIONS, AUTH_EVENT_ENTITY_TYPE, isAuthEventMethod } from "./auth-events.ts";

/**
 * The Audit trail now carries sign-ins alongside every business change, which is
 * what makes it useful for "was this account used at three in the morning" — and
 * also what makes it noisy when the question is "who changed this job".
 *
 * These are the two questions the trail is actually asked, plus the unfiltered
 * view. Anything wider belongs in a real query tool, not in a page that has to
 * stay index-backed and bounded.
 */
export const AUDIT_VIEWS = {
  all: { label: "ทั้งหมด", actions: null },
  auth: { label: "การเข้าสู่ระบบ", actions: AUTH_EVENT_ACTIONS },
  access: { label: "สิทธิ์ผู้ใช้", actions: ["INVITE", "UPDATE_ACCESS"] },
} as const satisfies Record<string, { label: string; actions: readonly string[] | null }>;

export type AuditViewKey = keyof typeof AUDIT_VIEWS;

export const DEFAULT_AUDIT_VIEW: AuditViewKey = "all";

export function isAuditViewKey(value: string): value is AuditViewKey {
  return Object.hasOwn(AUDIT_VIEWS, value);
}

/**
 * `undefined` means no filter was asked for. `null` means one was asked for and
 * it is not a view this page offers, which is a wrong URL rather than an empty
 * result — the page treats it as not found instead of silently showing
 * everything.
 */
export function parseAuditView(value: string | undefined): AuditViewKey | null | undefined {
  if (value === undefined || value === "") return undefined;
  return isAuditViewKey(value) ? value : null;
}

export function auditViewActions(view: AuditViewKey): readonly string[] | null {
  return AUDIT_VIEWS[view].actions;
}

export function auditViewKeys(): readonly AuditViewKey[] {
  return Object.keys(AUDIT_VIEWS) as AuditViewKey[];
}

/**
 * The detail line for one row. Auth events carry no free-text reason, but they
 * do carry how the person proved who they were, which is the part worth reading.
 * Anything unrecognised is reported as unrecognised rather than rendered raw.
 */
export function auditRowDetail(
  entityType: string,
  afterJson: string | null,
  reason: string | null,
): string | null {
  if (reason) return reason;
  if (entityType !== AUTH_EVENT_ENTITY_TYPE || !afterJson) return null;
  let method: unknown;
  try {
    method = (JSON.parse(afterJson) as { method?: unknown }).method;
  } catch {
    return null;
  }
  if (typeof method !== "string" || !isAuthEventMethod(method)) return null;
  return AUTH_EVENT_METHOD_LABELS[method];
}

const AUTH_EVENT_METHOD_LABELS: Record<string, string> = {
  password: "ยืนยันด้วยรหัสผ่าน",
  recovery_link: "ยืนยันด้วยลิงก์ทางอีเมล",
  current_password: "ยืนยันด้วยรหัสผ่านปัจจุบัน",
};
