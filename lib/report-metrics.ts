export type StatusMetric = { status: string; label: string; count: number };
export type ReportSection = { key: string; title: string; total: number; metrics: StatusMetric[] };

export function reportSection(key: string, title: string, rows: ReadonlyArray<{ status: string; value: number }>, labels: Record<string, string>): ReportSection {
  const metrics = rows.map((row) => ({ status: row.status, label: labels[row.status] ?? row.status, count: Number(row.value) })).sort((left, right) => left.status.localeCompare(right.status));
  return { key, title, total: metrics.reduce((sum, metric) => sum + metric.count, 0), metrics };
}
