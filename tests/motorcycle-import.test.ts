import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { MOTORCYCLE_IMPORT_MAX_ROWS, normalizeRows, parseCsv, prepareMotorcycleImport } from "../lib/motorcycle-import.ts";

test("CSV parser handles quoted commas, escaped quotes and embedded newlines", () => {
  assert.deepEqual(parseCsv('vin,notes\r\nVIN001,"งาน, ล็อตใหญ่"\r\nVIN002,"บรรทัด 1\nบรรทัด 2"'), [
    ["vin", "notes"], ["VIN001", "งาน, ล็อตใหญ่"], ["VIN002", "บรรทัด 1\nบรรทัด 2"],
  ]);
  assert.throws(() => parseCsv('vin\n"VIN001'), /ปิดไม่ครบ/);
});

test("normalizer accepts Thai/English headers and keeps extended motorcycle fields", () => {
  const [row] = normalizeRows([
    ["ยี่ห้อ", "รุ่น", "รุ่นย่อย", "ปี", "ทะเบียน", "จังหวัด", "เลขโครง", "เลขเครื่อง", "สภาพรถ", "หมายเหตุ"],
    ["Honda", "PCX", "ABS", "2026", "กข 123", "กรุงเทพฯ", " vin-001 ", " eng-001 ", "ใหม่", "รับจาก Dealer"],
  ]);
  assert.deepEqual({ make: row.make, model: row.model, variant: row.variant, modelYear: row.modelYear, registration: row.registration, province: row.province, vin: row.vin, engineNumber: row.engineNumber, condition: row.vehicleCondition, notes: row.notes, status: row.validationStatus }, {
    make: "Honda", model: "PCX", variant: "ABS", modelYear: 2026, registration: "กข 123", province: "กรุงเทพฯ", vin: "VIN-001", engineNumber: "ENG-001", condition: "NEW", notes: "รับจาก Dealer", status: "VALID",
  });
});

test("normalizer marks every duplicate and refuses ambiguous files", () => {
  const rows = normalizeRows([["vin", "engine_number"], ["DUP", "E1"], ["dup", "E2"]]);
  assert.equal(rows.every((row) => row.validationStatus === "ERROR"), true);
  assert.equal(rows.every((row) => row.errorMessage?.includes("ซ้ำภายในไฟล์")), true);
  assert.throws(() => normalizeRows([["make"], ["Honda"]]), /VIN\/เลขโครง/);
  assert.throws(() => normalizeRows([["vin", "unknown"], ["V1", "x"]]), /ไม่รู้จักหัวตาราง/);
  assert.throws(() => normalizeRows([["vin", "เลขโครง"], ["V1", "V2"]]), /หัวตารางซ้ำ/);
});

test("normalizer enforces row, year, identifier and text bounds", () => {
  const matrix = [["vin"], ...Array.from({ length: MOTORCYCLE_IMPORT_MAX_ROWS + 1 }, (_, index) => [`VIN-${index}`])];
  assert.throws(() => normalizeRows(matrix), /500/);
  const [row] = normalizeRows([["vin", "year", "notes"], ["", "1800", "x".repeat(1001)]]);
  assert.equal(row.validationStatus, "ERROR");
  assert.match(row.errorMessage ?? "", /VIN\/เลขโครง|ปีรถ|หมายเหตุ/);
});

test("real file preparation validates CSV bytes and produces SHA-256", async () => {
  const file = new File(["vin,engine_number\nVIN001,ENG001\n"], "motorcycles.csv", { type: "text/csv" });
  const prepared = await prepareMotorcycleImport(file);
  assert.equal(prepared.sourceType, "CSV");
  assert.equal(prepared.rows.length, 1);
  assert.match(prepared.checksum, /^[0-9a-f]{64}$/);
  await assert.rejects(() => prepareMotorcycleImport(new File(["vin\nV1"], "motorcycles.exe", { type: "application/octet-stream" })), /\.csv/);
});

test("XLSX parser reads a real ZIP workbook and rejects formulas", async () => {
  const valid = xlsxFile(`<row r="1"><c r="A1" t="inlineStr"><is><t>vin</t></is></c><c r="B1" t="inlineStr"><is><t>model</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>VIN-XLSX-1</t></is></c><c r="B2" t="inlineStr"><is><t>PCX</t></is></c></row>`);
  const prepared = await prepareMotorcycleImport(valid);
  assert.equal(prepared.sourceType, "XLSX");
  assert.equal(prepared.rows[0].vin, "VIN-XLSX-1");
  assert.equal(prepared.rows[0].model, "PCX");
  const formula = xlsxFile(`<row r="1"><c r="A1" t="inlineStr"><is><t>vin</t></is></c></row><row r="2"><c r="A2"><f>CONCAT("VIN",1)</f><v>VIN1</v></c></row>`);
  await assert.rejects(() => prepareMotorcycleImport(formula), /สูตร/);
});

function xlsxFile(sheetRows: string): File {
  const archive = zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Import" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`),
  });
  const copy = new Uint8Array(archive.byteLength);
  copy.set(archive);
  return new File([copy.buffer], "motorcycles.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
