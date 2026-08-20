import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the NATHEE public website without demo data", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(
    response.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );

  const html = await response.text();
  assert.match(html, /<title>NATHEE GROUP 2025 \| Motorcycle Logistics<\/title>/i);
  assert.match(html, /ขนส่งรถจักรยานยนต์/);
  assert.match(html, /ครอบคลุมทุกขั้นตอนการขนส่ง/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
  assert.doesNotMatch(html, /owner123|staff123|abc123|nathee2025/i);
  assert.doesNotMatch(html, /02-000-0000|@natheegroup|10,000\+|1,000\+/i);
});

test("server-renders the login baseline without embedded credentials", async () => {
  const response = await render("/login");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<title>เข้าสู่ระบบ \| NATHEE GROUP 2025<\/title>/i);
  assert.match(html, /UI พร้อมใช้งานแล้ว/);
  assert.match(html, /action="\/api\/auth\/login"/);
  assert.match(html, /disabled/);
  assert.doesNotMatch(html, /owner123|staff123|abc123|nathee2025/i);
});

test("server-renders password recovery without revealing account data", async () => {
  const response = await render("/forgot-password");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<title>ลืมรหัสผ่าน \| NATHEE GROUP 2025<\/title>/i);
  assert.match(html, /action="\/api\/auth\/forgot-password"/);
  assert.match(html, /disabled/);
  assert.doesNotMatch(html, /owner123|staff123|abc123|nathee2025/i);
});
