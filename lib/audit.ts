import { getDb } from "@/db";
import { auditLogs } from "@/db/schema";
import type { CurrentActor } from "@/lib/current-actor";

export type AuditInput = {
  actor: CurrentActor;
  action: string;
  entityType: string;
  entityId: string;
  companyId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

export function makeAuditRecord(input: AuditInput) {
  return {
    id: crypto.randomUUID(),
    actorUserId: input.actor.userId,
    companyId: input.companyId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeJson: input.before === undefined ? null : JSON.stringify(input.before),
    afterJson: input.after === undefined ? null : JSON.stringify(input.after),
    reason: input.reason ?? null,
  };
}

export async function writeAudit(input: AuditInput): Promise<void> {
  await getDb().insert(auditLogs).values(makeAuditRecord(input));
}
