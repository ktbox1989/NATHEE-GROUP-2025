import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";

const PNG_1X1 = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));

async function storeAngle(angle: string) {
  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    r2Buckets: ["FILES"],
    script: `
      export default { async fetch(request, env) {
        const angle = new URL(request.url).pathname.slice(1);
        const key = 'companies/company-a/motorcycles/mc-a/acceptance-' + angle + '.png';
        if (request.method === 'PUT') {
          const bytes = await request.arrayBuffer();
          await env.FILES.put(key, bytes, {
            httpMetadata: { contentType: 'image/png' },
            customMetadata: { motorcycleId: 'mc-a', companyId: 'company-a', category: angle }
          });
        }
        const object = await env.FILES.get(key);
        if (!object) return new Response('missing', { status: 404 });
        const bytes = await object.arrayBuffer();
        return Response.json({ key, size: bytes.byteLength, contentType: object.httpMetadata?.contentType, metadata: object.customMetadata });
      } };
    `,
  });
  try {
    const response = await runtime.dispatchFetch(`http://local.test/${angle}`, { method: "PUT", body: PNG_1X1 });
    assert.equal(response.status, 200);
    return await response.json() as { key: string; size: number; contentType: string; metadata: Record<string, string> };
  } finally {
    await runtime.dispose();
  }
}

for (const angle of ["LEFT", "RIGHT", "FRONT", "REAR"] as const) {
  test(`real local R2 stores and reads private ${angle} intake evidence with metadata`, async () => {
    const stored = await storeAngle(angle);
    assert.equal(stored.size, PNG_1X1.byteLength);
    assert.equal(stored.contentType, "image/png");
    assert.equal(stored.metadata.motorcycleId, "mc-a");
    assert.equal(stored.metadata.companyId, "company-a");
    assert.equal(stored.metadata.category, angle);
    assert.match(stored.key, new RegExp(`${angle}\\.png$`));
  });
}

test("local R2 compensation removes every candidate after a simulated metadata failure", async () => {
  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    r2Buckets: ["FILES"],
    script: `
      export default { async fetch(_request, env) {
        const keys = ['acceptance/original.png', 'acceptance/thumbnail.webp'];
        try {
          for (const key of keys) await env.FILES.put(key, new Uint8Array([1,2,3]));
          throw new Error('simulated metadata rejection');
        } catch {
          await Promise.allSettled(keys.map((key) => env.FILES.delete(key)));
        }
        const remaining = await Promise.all(keys.map((key) => env.FILES.head(key)));
        return Response.json({ remaining: remaining.filter(Boolean).length });
      } };
    `,
  });
  try {
    const response = await runtime.dispatchFetch("http://local.test/");
    assert.deepEqual(await response.json(), { remaining: 0 });
  } finally {
    await runtime.dispose();
  }
});
