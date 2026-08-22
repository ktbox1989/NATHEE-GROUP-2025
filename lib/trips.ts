import type { MotorcycleStatus, TripAssignmentState, TripStatus } from "../db/schema.ts";
import { eventTimestamp } from "./timestamps.ts";

export const TRIP_PAGE_SIZE = 50;

const transitions: Record<TripStatus, readonly TripStatus[]> = {
  DRAFT: ["PLANNED", "CANCELLED"],
  PLANNED: ["LOADING", "CANCELLED"],
  LOADING: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["ARRIVED"],
  ARRIVED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function normalizeTruckCode(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "-");
  return /^[A-Z0-9-]{2,30}$/.test(normalized) ? normalized : null;
}

export function normalizeRegistration(value: string): string | null | undefined {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.length <= 30 ? normalized : undefined;
}

export function isTripRequestKey(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function normalizeLoadBoardSearch(value: string): string | null | undefined {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  const hasWildcard = ["%", "_", "*", "?", "[", "]", "\\"].some((character) => normalized.includes(character));
  if (normalized.length < 2 || normalized.length > 50 || hasControlCharacter || hasWildcard) return undefined;
  return normalized;
}

export function parseTruckCapacity(value: string): number | null | undefined {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) return undefined;
  const result = Number(normalized);
  return Number.isSafeInteger(result) && result >= 1 && result <= 1000 ? result : undefined;
}

export function bangkokInputToUtc(value: string): string | null | undefined {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(normalized)) return undefined;
  const withSeconds = normalized.length === 16 ? `${normalized}:00` : normalized;
  const parsed = new Date(`${withSeconds}+07:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const roundTrip = new Date(parsed.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 19);
  // A planned departure is a real-world instant, CHECK-compared against the
  // planned arrival as text, so it uses the event representation.
  return roundTrip === withSeconds ? eventTimestamp(parsed) : undefined;
}

export function isPlannedTripOrderValid(departure: string | null, arrival: string | null): boolean {
  return !departure || !arrival || arrival >= departure;
}

export function canTransitionTrip(from: TripStatus, to: TripStatus): boolean {
  return transitions[from].includes(to);
}

export function allowedTripTransitions(from: TripStatus): readonly TripStatus[] {
  return transitions[from];
}

const assignmentTransitions: Record<TripAssignmentState, readonly TripAssignmentState[]> = {
  ASSIGNED: ["LOADED", "RELEASED"],
  LOADED: ["UNLOADED"],
  UNLOADED: ["RELEASED"],
  RELEASED: [],
};

export function canTransitionTripAssignment(from: TripAssignmentState, to: TripAssignmentState): boolean {
  return assignmentTransitions[from].includes(to);
}

export function motorcycleStatusAllowsAssignmentState(state: TripAssignmentState, status: MotorcycleStatus): boolean {
  if (state === "ASSIGNED") return status === "SCHEDULED";
  if (state === "LOADED") return status === "LOADED" || status === "IN_TRANSIT";
  if (state === "UNLOADED") return ["ARRIVED", "DELIVERED", "CLOSED"].includes(status);
  return true;
}

export function tripStatusAllowsAssignmentTransition(from: TripAssignmentState, to: TripAssignmentState, tripStatus: TripStatus): boolean {
  if (to === "LOADED") return tripStatus === "LOADING";
  if (to === "UNLOADED") return tripStatus === "ARRIVED";
  if (to === "RELEASED" && from === "ASSIGNED") return ["DRAFT", "PLANNED", "CANCELLED"].includes(tripStatus);
  if (to === "RELEASED" && from === "UNLOADED") return tripStatus === "COMPLETED";
  return false;
}

export type TripReadinessAssignment = {
  state: TripAssignmentState;
  motorcycleStatus: MotorcycleStatus;
};

export function tripReadinessIssue(nextStatus: TripStatus, assignments: readonly TripReadinessAssignment[]): string | null {
  const active = assignments.filter((assignment) => assignment.state !== "RELEASED");
  if (nextStatus === "LOADING" && active.length === 0) return "ต้องจัดรถจักรยานยนต์อย่างน้อย 1 คันก่อนเริ่มขึ้นรถ";
  if (nextStatus === "IN_TRANSIT") {
    if (active.length === 0) return "ยังไม่มีรถจักรยานยนต์ในเที่ยว";
    if (active.some((assignment) => assignment.state !== "LOADED")) return "ยืนยันขึ้นรถให้ครบทุกคันก่อนออกเดินทาง";
    if (active.some((assignment) => assignment.motorcycleStatus !== "IN_TRANSIT")) return "เปลี่ยนสถานะรถทุกคันเป็นกำลังขนส่งก่อนออกเที่ยว";
  }
  if (nextStatus === "ARRIVED") {
    if (active.length === 0) return "ยังไม่มีรถจักรยานยนต์ในเที่ยว";
    if (active.some((assignment) => assignment.state !== "LOADED")) return "ข้อมูลรถบนเที่ยวไม่สอดคล้องกับการถึงปลายทาง";
    if (active.some((assignment) => !["ARRIVED", "DELIVERED", "CLOSED"].includes(assignment.motorcycleStatus))) return "เปลี่ยนสถานะรถทุกคันเป็นถึงปลายทางก่อน";
  }
  if (nextStatus === "COMPLETED") {
    if (active.length === 0) return "ยังไม่มีรถจักรยานยนต์ในเที่ยว";
    if (active.some((assignment) => assignment.state !== "UNLOADED")) return "ยืนยันลงรถให้ครบทุกคันก่อนปิดเที่ยว";
    if (active.some((assignment) => !["DELIVERED", "CLOSED"].includes(assignment.motorcycleStatus))) return "ส่งมอบหรือปิดงานรถทุกคันก่อนปิดเที่ยว";
  }
  if (nextStatus === "CANCELLED" && active.some((assignment) => assignment.state !== "ASSIGNED")) {
    return "ยกเลิกเที่ยวไม่ได้หลังเริ่มขึ้นรถแล้ว";
  }
  return null;
}
