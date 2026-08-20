import type { MotorcycleStatus } from "../db/schema.ts";

const transitions: Record<MotorcycleStatus, readonly MotorcycleStatus[]> = {
  PENDING_RECEIPT: ["RECEIVED", "ISSUE", "CANCELLED"],
  RECEIVED: ["INSPECTED", "ISSUE", "DAMAGED", "CANCELLED"],
  INSPECTED: ["IN_YARD", "ISSUE", "DAMAGED", "WAITING_DOCUMENTS"],
  IN_YARD: ["SCHEDULED", "ISSUE", "DAMAGED", "WAITING_DOCUMENTS"],
  SCHEDULED: ["IN_YARD", "LOADED", "ISSUE", "CANCELLED"],
  LOADED: ["IN_TRANSIT", "ISSUE", "DAMAGED"],
  IN_TRANSIT: ["ARRIVED", "ISSUE", "DAMAGED"],
  ARRIVED: ["DELIVERED", "ISSUE", "DAMAGED"],
  DELIVERED: ["CLOSED", "ISSUE"],
  CLOSED: [],
  ISSUE: ["RECEIVED", "INSPECTED", "IN_YARD", "SCHEDULED", "LOADED", "IN_TRANSIT", "ARRIVED", "DELIVERED", "CANCELLED"],
  DAMAGED: ["ISSUE", "CANCELLED"],
  WAITING_DOCUMENTS: ["RECEIVED", "INSPECTED", "IN_YARD", "SCHEDULED", "CANCELLED"],
  CANCELLED: [],
};

export class InvalidStatusTransitionError extends Error {
  readonly code = "INVALID_STATUS_TRANSITION";

  constructor(from: MotorcycleStatus, to: MotorcycleStatus) {
    super(`Status cannot change from ${from} to ${to}.`);
    this.name = "InvalidStatusTransitionError";
  }
}

export function canTransition(
  from: MotorcycleStatus,
  to: MotorcycleStatus,
): boolean {
  return transitions[from].includes(to);
}

export function allowedTransitions(
  from: MotorcycleStatus,
): readonly MotorcycleStatus[] {
  return transitions[from];
}

export function assertStatusTransition(
  from: MotorcycleStatus,
  to: MotorcycleStatus,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
}
