import type { ImageCategory } from "../db/schema.ts";

export const RECEIPT_EVIDENCE_ANGLES = ["LEFT", "RIGHT", "FRONT", "REAR"] as const;
export type ReceiptEvidenceAngle = (typeof RECEIPT_EVIDENCE_ANGLES)[number];

export type ReceiptEvidenceIds = {
  leftImageId: string;
  rightImageId: string;
  frontImageId: string;
  rearImageId: string;
};

export type ReceiptEvidenceMetadata = {
  id: string;
  motorcycleId: string;
  companyId: string;
  category: ImageCategory;
};

const fields = [
  ["leftImageId", "LEFT"],
  ["rightImageId", "RIGHT"],
  ["frontImageId", "FRONT"],
  ["rearImageId", "REAR"],
] as const;

export function parseReceiptEvidence(form: FormData): ReceiptEvidenceIds | null {
  const result = Object.fromEntries(fields.map(([field]) => [field, String(form.get(field) ?? "").trim()]));
  if (Object.values(result).some((value) => !value || value.length > 100)) return null;
  return result as ReceiptEvidenceIds;
}

export function receiptEvidenceMatches(
  evidence: ReceiptEvidenceIds,
  metadata: readonly ReceiptEvidenceMetadata[],
  motorcycleId: string,
  companyId: string,
): boolean {
  if (new Set(Object.values(evidence)).size !== fields.length) return false;
  return fields.every(([field, category]) => metadata.some((image) =>
    image.id === evidence[field]
    && image.motorcycleId === motorcycleId
    && image.companyId === companyId
    && image.category === category,
  ));
}

export function receiptInspectionHasFourAngles(inspection: {
  leftImageId: string | null;
  rightImageId: string | null;
  frontImageId: string | null;
  rearImageId: string | null;
}): boolean {
  return Boolean(inspection.leftImageId && inspection.rightImageId && inspection.frontImageId && inspection.rearImageId);
}
