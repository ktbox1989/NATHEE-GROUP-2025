import assert from "node:assert/strict";
import test from "node:test";
import { renderMotorcycleQrSvg } from "../lib/qr-svg.ts";

test("QR renderer creates a script-free SVG from an opaque public identifier", async () => {
  const svg = await renderMotorcycleQrSvg(`mc_${"b".repeat(32)}`);
  assert.match(svg, /^<svg[^>]+>/);
  assert.match(svg, /<path/);
  assert.doesNotMatch(svg, /<script/i);
  assert.doesNotMatch(svg, /VIN|engine|registration|customer/i);
});
