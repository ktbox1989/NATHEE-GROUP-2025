import type { MotorcycleStatus, NotificationSeverity } from "../db/schema.ts";
import { motorcycleStatusLabels } from "./labels.ts";

export type StatusNotificationContent = {
  title: string;
  body: string;
  severity: NotificationSeverity;
  href: string;
};

export function statusNotificationContent(input: {
  motorcycleId: string;
  publicId: string;
  newStatus: MotorcycleStatus;
}): StatusNotificationContent {
  const severity: NotificationSeverity =
    input.newStatus === "DAMAGED" || input.newStatus === "ISSUE"
      ? "CRITICAL"
      : input.newStatus === "WAITING_DOCUMENTS" || input.newStatus === "CANCELLED"
        ? "WARNING"
        : "INFO";

  return {
    title: severity === "CRITICAL" ? "มีสถานะรถที่ต้องตรวจสอบ" : "สถานะรถมีการอัปเดต",
    body: `${input.publicId} · ${motorcycleStatusLabels[input.newStatus]}`,
    severity,
    href: `/app/motorcycles/${encodeURIComponent(input.motorcycleId)}`,
  };
}

export function isSafeNotificationHref(value: string): boolean {
  if (!value.startsWith("/app/") || value.includes("\\")) return false;
  try {
    const base = "https://local.invalid";
    const url = new URL(value, base);
    return url.origin === base && url.pathname.startsWith("/app/");
  } catch {
    return false;
  }
}
