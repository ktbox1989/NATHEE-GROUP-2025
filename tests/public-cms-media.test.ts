import assert from "node:assert/strict";
import test from "node:test";
import type { PublicMedia } from "../lib/public-cms/contract.ts";
import { buildGalleryRenderModels, buildMediaRenderModel } from "../lib/public-cms/media.ts";

function media(overrides: Partial<PublicMedia> = {}): PublicMedia {
  return {
    id: "motorcycle-truck-loading-01",
    altText: "รถบรรทุกกำลังโหลดรถจักรยานยนต์",
    caption: null,
    variants: [
      { src: "/assets/gallery/a-thumbnail.avif", width: 640, height: 360, format: "avif", role: "thumbnail" },
      { src: "/assets/gallery/a-display.avif", width: 1600, height: 900, format: "avif", role: "display" },
      { src: "/assets/gallery/a-thumbnail.webp", width: 640, height: 360, format: "webp", role: "thumbnail" },
      { src: "/assets/gallery/a-display.webp", width: 1600, height: 900, format: "webp", role: "display" },
      { src: "/assets/gallery/a-thumbnail.jpg", width: 640, height: 360, format: "jpeg", role: "thumbnail" },
      { src: "/assets/gallery/a-display.jpg", width: 1600, height: 900, format: "jpeg", role: "display" },
    ],
    ...overrides,
  };
}

test("a complete image renders modern sources with a raster fallback", () => {
  const result = buildMediaRenderModel(media());
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // Most efficient first: the browser takes the first type it understands.
  assert.deepEqual(result.model.sources.map((source) => source.type), ["image/avif", "image/webp"]);
  // The <img> itself must carry a universally decodable format.
  assert.match(result.model.img.src, /\.jpg$/);
  assert.match(result.model.img.srcset, /a-thumbnail\.jpg 640w/);
  assert.match(result.model.img.srcset, /a-display\.jpg 1600w/);
});

test("intrinsic dimensions and aspect ratio are always emitted", () => {
  const result = buildMediaRenderModel(media());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Without these the page reflows as each photograph arrives.
  assert.equal(result.model.img.width, 1600);
  assert.equal(result.model.img.height, 900);
  assert.equal(result.model.aspectRatio, "1600 / 900");
  assert.equal(result.model.orientation, "landscape");
});

test("only a priority image loads eagerly", () => {
  const lazy = buildMediaRenderModel(media());
  assert.equal(lazy.ok && lazy.model.img.loading, "lazy");
  assert.equal(lazy.ok && lazy.model.img.fetchpriority, undefined);

  const hero = buildMediaRenderModel(media(), { priority: true });
  assert.equal(hero.ok && hero.model.img.loading, "eager");
  assert.equal(hero.ok && hero.model.img.fetchpriority, "high");
});

test("an image without alt text is refused rather than rendered", () => {
  for (const altText of ["", "   "]) {
    const result = buildMediaRenderModel(media({ altText }));
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "media has no alt text");
  }
});

test("private media is dropped at render time as well as on arrival", () => {
  // Defence in depth: this is the last check before markup, and the one place
  // where a CMS mistake becomes a privacy incident.
  const leaking = media({
    variants: [
      { src: "/api/images/secret?role=display", width: 1600, height: 900, format: "jpeg", role: "display" },
      { src: "/api/pod-signatures/secret", width: 640, height: 360, format: "png", role: "thumbnail" },
    ],
  });
  const result = buildMediaRenderModel(leaking);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "media has no usable variant");
});

test("one malformed variant does not break the whole image", () => {
  const partly = media({
    variants: [
      { src: "https://evil.example/x.webp", width: 1600, height: 900, format: "webp", role: "display" },
      { src: "/assets/gallery/a-display.jpg", width: 1600, height: 900, format: "jpeg", role: "display" },
    ],
  });
  const result = buildMediaRenderModel(partly);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // The off-site source is gone; the good one still renders.
  assert.equal(result.model.sources.length, 0);
  assert.equal(result.model.img.src, "/assets/gallery/a-display.jpg");
});

test("an image with no decodable fallback is refused", () => {
  // avif-only would leave older browsers with an empty frame.
  const avifOnly = media({
    variants: [{ src: "/assets/gallery/a-display.avif", width: 1600, height: 900, format: "avif", role: "display" }],
  });
  const result = buildMediaRenderModel(avifOnly);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "media has no jpeg or png fallback");
});

test("variants with missing or absurd dimensions are dropped", () => {
  const broken = media({
    variants: [
      { src: "/assets/gallery/a.jpg", width: 0, height: 900, format: "jpeg", role: "display" },
      { src: "/assets/gallery/b.jpg", width: 1600, height: -1, format: "jpeg", role: "display" },
    ],
  });
  assert.equal(buildMediaRenderModel(broken).ok, false);
});

test("the lightbox is always announced, falling back to alt text", () => {
  const withCaption = buildMediaRenderModel(media({ caption: "ลานสต๊อกรถจักรยานยนต์" }));
  assert.equal(withCaption.ok && withCaption.model.lightbox.label, "ลานสต๊อกรถจักรยานยนต์");

  const withoutCaption = buildMediaRenderModel(media({ caption: null }));
  assert.equal(withoutCaption.ok && withoutCaption.model.lightbox.label, media().altText);

  // A blank caption must not produce an unlabelled control.
  const blankCaption = buildMediaRenderModel(media({ caption: "   " }));
  assert.equal(blankCaption.ok && blankCaption.model.lightbox.label, media().altText);

  const disabled = buildMediaRenderModel(media(), { lightbox: false });
  assert.equal(disabled.ok && disabled.model.lightbox.enabled, false);
});

test("portrait photographs are marked so they are not stretched", () => {
  const portrait = media({
    variants: [{ src: "/assets/gallery/p.jpg", width: 900, height: 1600, format: "jpeg", role: "display" }],
  });
  const result = buildMediaRenderModel(portrait);
  assert.equal(result.ok && result.model.orientation, "portrait");
  assert.equal(result.ok && result.model.aspectRatio, "900 / 1600");

  const square = buildMediaRenderModel(
    media({ variants: [{ src: "/assets/gallery/s.jpg", width: 1000, height: 1000, format: "jpeg", role: "display" }] }),
  );
  assert.equal(square.ok, true);
  if (square.ok) assert.equal(square.model.orientation, "square");
});

test("a gallery renders every good item and reports the broken ones", () => {
  const { models, skipped } = buildGalleryRenderModels([
    media({ id: "good-1" }),
    media({ id: "no-alt", altText: "" }),
    media({ id: "good-2" }),
    media({ id: "private", variants: [{ src: "/api/images/x", width: 10, height: 10, format: "jpeg", role: "display" }] }),
  ]);

  // One bad item must not take the gallery down with it.
  assert.equal(models.length, 2);
  assert.deepEqual(skipped.map((item) => item.id), ["no-alt", "private"]);
});

test("only the first gallery image can be eager", () => {
  const { models } = buildGalleryRenderModels([media({ id: "a" }), media({ id: "b" }), media({ id: "c" })], {
    priority: true,
  });
  assert.deepEqual(models.map((model) => model.img.loading), ["eager", "lazy", "lazy"]);
});

test("sizes is emitted on the img and every source", () => {
  const custom = "(max-width: 980px) calc(100vw - 40px), 520px";
  const result = buildMediaRenderModel(media(), { sizes: custom });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.model.img.sizes, custom);
  for (const source of result.model.sources) assert.equal(source.sizes, custom);
});
