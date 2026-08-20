import assert from "node:assert/strict";
import test from "node:test";
import { renderMotorcycleQrSvg, renderOperationalQrSvg } from "../lib/qr-svg.ts";

test("QR renderer creates a script-free SVG from an opaque public identifier", async () => {
  const svg = await renderMotorcycleQrSvg(`mc_${"b".repeat(32)}`);
  assert.match(svg, /^<svg[^>]+>/);
  assert.match(svg, /<path/);
  assert.doesNotMatch(svg, /<script/i);
  assert.doesNotMatch(svg, /VIN|engine|registration|customer/i);
});

test("operational QR renderer supports every non-vehicle opaque identity", async () => {
  for (const [entityType, prefix] of [["job", "job_"], ["yard", "yard_"], ["truck", "truck_"], ["trip", "trip_"]] as const) {
    const svg = await renderOperationalQrSvg(entityType, `${prefix}${"c".repeat(32)}`);
    assert.match(svg, /^<svg[^>]+>/);
    assert.doesNotMatch(svg, /<script|VIN|engine|registration|customer/i);
  }
});
