import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("motorcycle creation assigns one canonical opaque QR identity and records the assignment", async () => {
  const source = await readFile("app/api/motorcycles/route.ts", "utf8");
  assert.match(source, /publicId: `mc_\$\{crypto\.randomUUID\(\)\.replaceAll\("-", ""\)\}`/);
  assert.match(source, /action: "QR_ASSIGN"/);
  assert.match(source, /after: \{ publicId: record\.publicId \}/);
});

test("authorized QR scan resolves backend inspection and yard state and audits the read", async () => {
  const source = await readFile("app/app/scan/page.tsx", "utf8");
  const authorization = source.indexOf('can(actor, "motorcycles:read", record.companyId)');
  const audit = source.indexOf('action: "QR_RESOLVE"');
  assert.ok(authorization >= 0 && audit > authorization, "authorization must precede the QR read audit");
  assert.match(source, /motorcycleInspections/);
  assert.match(source, /getMotorcycleLocation\(record\.id\)/);
  assert.match(source, /ตำแหน่งลาน/);
  assert.match(source, /รูปครบ 4 มุม/);
});

test("intake mutation surfaces use pending UI and reload server-confirmed state", async () => {
  const list = await readFile("app/app/motorcycles/page.tsx", "utf8");
  const detail = await readFile("app/app/motorcycles/[id]/page.tsx", "utf8");
  assert.match(list, /<PendingForm[^>]+action="\/api\/motorcycles"/);
  assert.match(detail, /expectedFingerprint/);
  assert.match(await readFile("app/api/motorcycles/[id]/route.ts", "utf8"), /changes\(\) = 1/);
  assert.match(detail, /busyLabel="กำลังบันทึกข้อมูลรับรถ…"/);
  assert.match(detail, /ข้อมูลทุกขั้นอ่านจาก Backend/);
});

test("image upload preserves the selected category after the busy state disables controls", async () => {
  const uploadForm = await readFile("components/motorcycle-image-upload-form.tsx", "utf8");
  const capture = uploadForm.indexOf("const category = selectedMotorcycleImageCategory(new FormData(formElement))");
  const disable = uploadForm.indexOf("setBusy(true)");
  const restore = uploadForm.indexOf('body.set("category", category)');

  assert.ok(capture >= 0 && capture < disable, "category must be captured before busy disables the select");
  assert.ok(restore > disable, "captured category must be written into the upload payload");
});
