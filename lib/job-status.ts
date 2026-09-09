import { JOB_STATUSES, type MotorcycleStatus } from "../db/schema.ts";

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  DRAFT: "ร่าง",
  OPEN: "เปิดงาน",
  IN_PROGRESS: "กำลังดำเนินงาน",
  COMPLETED: "เสร็จสิ้น",
  CANCELLED: "ยกเลิก",
};

const transitions: Record<JobStatus, readonly JobStatus[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const terminalMotorcycleStatuses = new Set<MotorcycleStatus>([
  "DELIVERED",
  "CLOSED",
  "CANCELLED",
]);
export function parseJobStatus(value: string): JobStatus | null {
  return JOB_STATUSES.includes(value as JobStatus) ? (value as JobStatus) : null;
}

export function allowedJobTransitions(status: JobStatus): readonly JobStatus[] {
  return transitions[status];
}

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return transitions[from].includes(to);
}

export type JobCompletionIssue = "no_motorcycles" | "pending_motorcycles";

export function jobCompletionIssue(
  statuses: readonly MotorcycleStatus[],
): JobCompletionIssue | null {
  if (statuses.length === 0) return "no_motorcycles";
  return statuses.every((status) => terminalMotorcycleStatuses.has(status))
    ? null
    : "pending_motorcycles";
}
