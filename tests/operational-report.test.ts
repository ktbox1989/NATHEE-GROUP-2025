import assert from "node:assert/strict";
import test from "node:test";
import { reportSection } from "../lib/report-metrics.ts";

test("operational report totals only real grouped rows", () => {
  assert.deepEqual(reportSection("jobs", "งาน", [
    { status: "OPEN", value: 3 },
    { status: "COMPLETED", value: 7 },
  ], { OPEN: "เปิดงาน", COMPLETED: "เสร็จสิ้น" }), {
    key: "jobs",
    title: "งาน",
    total: 10,
    metrics: [
      { status: "COMPLETED", label: "เสร็จสิ้น", count: 7 },
      { status: "OPEN", label: "เปิดงาน", count: 3 },
    ],
  });
});

test("operational report never invents missing statuses", () => {
  const result = reportSection("trips", "เที่ยว", [], { PLANNED: "วางแผน" });
  assert.equal(result.total, 0);
  assert.deepEqual(result.metrics, []);
});
