import type {
  ContainerAssignmentState,
  ContainerStatus,
  MotorcycleStatus,
} from "../db/schema.ts";

export const CONTAINER_PAGE_SIZE = 50;

const transitions: Record<ContainerStatus, readonly ContainerStatus[]> = {
  DRAFT: ["PLANNED", "CANCELLED"],
  PLANNED: ["LOADING", "CANCELLED"],
  LOADING: ["SEALED", "CANCELLED"],
  SEALED: ["IN_TRANSIT"],
  IN_TRANSIT: ["ARRIVED"],
  ARRIVED: ["UNLOADING"],
  UNLOADING: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

const assignmentTransitions: Record<ContainerAssignmentState, readonly ContainerAssignmentState[]> = {
  ASSIGNED: ["LOADED", "RELEASED"],
  LOADED: ["UNLOADED"],
  UNLOADED: ["RELEASED"],
  RELEASED: [],
};

const letterValues: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
  K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
  U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

export function normalizeContainerNumber(value: string): string | null {
  const normalized = value.toUpperCase().replace(/[\s-]+/g, "");
  if (!/^[A-Z]{3}[UJZ]\d{7}$/.test(normalized)) return null;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const character = normalized[index];
    const numeric = index < 4 ? letterValues[character] : Number(character);
    sum += numeric * (2 ** index);
  }
  const expectedCheckDigit = (sum % 11) % 10;
  return Number(normalized[10]) === expectedCheckDigit ? normalized : null;
}

export function normalizeContainerText(value: string, maxLength = 100): string | null | undefined {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.length <= maxLength ? normalized : undefined;
}

export function canTransitionContainer(from: ContainerStatus, to: ContainerStatus): boolean {
  return transitions[from].includes(to);
}

export function allowedContainerTransitions(from: ContainerStatus): readonly ContainerStatus[] {
  return transitions[from];
}

export function canTransitionContainerAssignment(
  from: ContainerAssignmentState,
  to: ContainerAssignmentState,
): boolean {
  return assignmentTransitions[from].includes(to);
}

export function motorcycleStatusAllowsContainerAssignmentState(
  state: ContainerAssignmentState,
  status: MotorcycleStatus,
): boolean {
  if (state === "ASSIGNED") return status === "SCHEDULED";
  if (state === "LOADED") return status === "LOADED";
  if (state === "UNLOADED") return ["ARRIVED", "DELIVERED", "CLOSED"].includes(status);
  return true;
}

export function containerStatusAllowsAssignmentTransition(
  from: ContainerAssignmentState,
  to: ContainerAssignmentState,
  containerStatus: ContainerStatus,
): boolean {
  if (to === "LOADED") return containerStatus === "LOADING";
  if (to === "UNLOADED") return containerStatus === "UNLOADING";
  if (to === "RELEASED" && from === "ASSIGNED") {
    return ["DRAFT", "PLANNED", "CANCELLED"].includes(containerStatus);
  }
  if (to === "RELEASED" && from === "UNLOADED") return containerStatus === "COMPLETED";
  return false;
}

export type ContainerReadinessAssignment = {
  state: ContainerAssignmentState;
  motorcycleStatus: MotorcycleStatus;
};

export function containerReadinessIssue(
  nextStatus: ContainerStatus,
  assignments: readonly ContainerReadinessAssignment[],
  sealNumber: string | null,
): string | null {
  const active = assignments.filter((assignment) => assignment.state !== "RELEASED");
  if (["PLANNED", "LOADING"].includes(nextStatus) && active.length === 0) {
    return "ต้องจัดรถจักรยานยนต์อย่างน้อย 1 คันก่อนเริ่มแผนโหลดตู้";
  }
  if (nextStatus === "SEALED") {
    if (!sealNumber) return "ต้องบันทึกเลข Seal จริงก่อนปิดตู้";
    if (active.length === 0) return "ยังไม่มีรถจักรยานยนต์ในตู้";
    if (active.some((assignment) => assignment.state !== "LOADED")) return "ยืนยันรถขึ้นตู้ให้ครบทุกคันก่อนปิด Seal";
    if (active.some((assignment) => assignment.motorcycleStatus !== "LOADED")) return "สถานะรถทุกคันต้องเป็นขึ้นรถแล้วก่อนปิด Seal";
  }
  if (nextStatus === "IN_TRANSIT") {
    if (active.length === 0) return "ยังไม่มีรถจักรยานยนต์ในตู้";
    if (active.some((assignment) => assignment.state !== "LOADED")) return "ข้อมูลรถในตู้ไม่ครบก่อนออกเดินทาง";
    if (active.some((assignment) => assignment.motorcycleStatus !== "IN_TRANSIT")) return "เปลี่ยนสถานะรถทุกคันเป็นกำลังขนส่งก่อนออกเดินทาง";
  }
  if (["ARRIVED", "UNLOADING"].includes(nextStatus)) {
    if (active.length === 0) return "ยังไม่มีรถจักรยานยนต์ในตู้";
    if (active.some((assignment) => assignment.state !== "LOADED")) return "ข้อมูลรถในตู้ไม่สอดคล้องกับการถึงปลายทาง";
    if (active.some((assignment) => !["ARRIVED", "DELIVERED", "CLOSED"].includes(assignment.motorcycleStatus))) {
      return "เปลี่ยนสถานะรถทุกคันเป็นถึงปลายทางก่อน";
    }
  }
  if (nextStatus === "COMPLETED") {
    if (active.length === 0) return "ยังไม่มีรถจักรยานยนต์ในตู้";
    if (active.some((assignment) => assignment.state !== "UNLOADED")) return "ยืนยันนำรถลงจากตู้ให้ครบทุกคันก่อนปิดงาน";
    if (active.some((assignment) => !["DELIVERED", "CLOSED"].includes(assignment.motorcycleStatus))) {
      return "ส่งมอบหรือปิดงานรถทุกคันก่อนปิดตู้";
    }
  }
  if (nextStatus === "CANCELLED" && active.some((assignment) => assignment.state !== "ASSIGNED")) {
    return "ยกเลิกตู้ไม่ได้หลังเริ่มโหลดรถแล้ว";
  }
  return null;
}
