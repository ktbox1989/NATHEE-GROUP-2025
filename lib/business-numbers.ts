import { getD1 } from "@/db";

const incrementSql = `
  INSERT INTO sequence_counters (name, value, updated_at)
  VALUES (?, 1, CURRENT_TIMESTAMP)
  ON CONFLICT(name) DO UPDATE SET
    value = sequence_counters.value + 1,
    updated_at = CURRENT_TIMESTAMP
  RETURNING value
`;

export async function nextSequence(name: string): Promise<number> {
  const row = await getD1()
    .prepare(incrementSql)
    .bind(name)
    .first<{ value: number }>();

  if (!row) throw new Error("Could not allocate the next business sequence.");
  return row.value;
}

function currentBangkokYear(): string {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(new Date());
}

export async function nextBusinessNumber(prefix: "JOB" | "QT") {
  const year = currentBangkokYear();
  const value = await nextSequence(`${prefix}:${year}`);
  return `${prefix}-${year}-${String(value).padStart(6, "0")}`;
}
