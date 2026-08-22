// Turning CMS media into something safe to render.
//
// The contract validates a payload on arrival. This builds the render model,
// and re-checks every source on the way out. That duplication is deliberate:
// media is the one place where a CMS mistake becomes a privacy incident rather
// than a typo, so the last thing before markup checks again.
//
// A pure data model rather than JSX, so the rules are testable without a
// renderer, and so the same model can drive the static build and a future
// server-rendered page.

import { validateMediaSrc, type PublicMedia, type PublicMediaVariant } from "./contract.ts";

export type RenderedSource = {
  type: string;
  srcset: string;
  sizes: string;
};

export type MediaRenderModel = {
  // <picture> sources, most-preferred format first.
  sources: RenderedSource[];
  img: {
    src: string;
    srcset: string;
    sizes: string;
    alt: string;
    width: number;
    height: number;
    loading: "lazy" | "eager";
    decoding: "async";
    fetchpriority?: "high";
  };
  caption: string | null;
  // Emitted as a CSS aspect-ratio so the space is reserved before the image
  // arrives; without it the page reflows as each photograph loads.
  aspectRatio: string;
  orientation: "landscape" | "portrait" | "square";
  lightbox: { enabled: boolean; fullSrc: string; label: string };
};

export type MediaRenderFailure = { ok: false; reason: string };
export type MediaRenderResult = { ok: true; model: MediaRenderModel } | MediaRenderFailure;

const MIME_BY_FORMAT: Readonly<Record<PublicMediaVariant["format"], string>> = Object.freeze({
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png",
});

// Most efficient first: the browser takes the first type it understands.
const FORMAT_PREFERENCE: ReadonlyArray<PublicMediaVariant["format"]> = ["avif", "webp", "jpeg", "png"];

export type MediaRenderOptions = {
  // The hero loads eagerly; everything else waits until it is near the
  // viewport. Getting this backwards is the usual cause of a slow first paint.
  priority?: boolean;
  sizes?: string;
  lightbox?: boolean;
};

const DEFAULT_SIZES = "(max-width: 680px) calc(100vw - 28px), (max-width: 980px) calc(50vw - 32px), 374px";

function usableVariants(media: PublicMedia): PublicMediaVariant[] {
  // Re-validate here as well as on arrival. A variant that fails is dropped
  // rather than rendered, so one bad entry cannot break the whole image or
  // leak a private path.
  return media.variants.filter((variant) => {
    if (validateMediaSrc(variant.src, "src").length > 0) return false;
    if (!Number.isInteger(variant.width) || variant.width <= 0) return false;
    if (!Number.isInteger(variant.height) || variant.height <= 0) return false;
    return MIME_BY_FORMAT[variant.format] !== undefined;
  });
}

function describeOrientation(width: number, height: number): MediaRenderModel["orientation"] {
  const ratio = width / height;
  if (ratio > 1.12) return "landscape";
  if (ratio < 0.88) return "portrait";
  return "square";
}

function srcsetFor(variants: PublicMediaVariant[]): string {
  return [...variants]
    .sort((left, right) => left.width - right.width)
    .map((variant) => `${variant.src} ${variant.width}w`)
    .join(", ");
}

/**
 * Builds the render model, or explains why the image cannot be rendered.
 *
 * Returning a failure rather than a partial model matters: a broken <img> on a
 * sales page looks worse than no image, and an image without alt text or
 * dimensions fails the gates the live site already meets.
 */
export function buildMediaRenderModel(
  media: PublicMedia,
  options: MediaRenderOptions = {},
): MediaRenderResult {
  if (typeof media?.altText !== "string" || media.altText.trim().length === 0) {
    return { ok: false, reason: "media has no alt text" };
  }

  const variants = usableVariants(media);
  if (variants.length === 0) return { ok: false, reason: "media has no usable variant" };

  // The raster fallback must be a format every browser can decode; avif or
  // webp alone would leave older clients with nothing in the <img>.
  const fallbacks = variants.filter((variant) => variant.format === "jpeg" || variant.format === "png");
  if (fallbacks.length === 0) return { ok: false, reason: "media has no jpeg or png fallback" };

  const display =
    fallbacks.find((variant) => variant.role === "display") ??
    [...fallbacks].sort((left, right) => right.width - left.width)[0];

  const sizes = options.sizes ?? DEFAULT_SIZES;

  const sources: RenderedSource[] = [];
  for (const format of FORMAT_PREFERENCE) {
    if (format === "jpeg" || format === "png") continue; // carried by the <img>
    const matching = variants.filter((variant) => variant.format === format);
    if (matching.length === 0) continue;
    sources.push({ type: MIME_BY_FORMAT[format], srcset: srcsetFor(matching), sizes });
  }

  const lightboxEnabled = options.lightbox !== false;

  return {
    ok: true,
    model: {
      sources,
      img: {
        src: display.src,
        srcset: srcsetFor(fallbacks),
        sizes,
        alt: media.altText,
        width: display.width,
        height: display.height,
        loading: options.priority ? "eager" : "lazy",
        decoding: "async",
        ...(options.priority ? { fetchpriority: "high" as const } : {}),
      },
      caption: media.caption,
      aspectRatio: `${display.width} / ${display.height}`,
      orientation: describeOrientation(display.width, display.height),
      lightbox: {
        enabled: lightboxEnabled,
        fullSrc: display.src,
        // The lightbox label falls back to alt text, never to an empty string,
        // so the control is always announced.
        label: media.caption?.trim() || media.altText,
      },
    },
  };
}

/**
 * Builds the models for a set of media, dropping any that cannot be rendered
 * and reporting them. A gallery with one broken item still renders the rest.
 */
export function buildGalleryRenderModels(
  items: ReadonlyArray<PublicMedia>,
  options: MediaRenderOptions = {},
): { models: MediaRenderModel[]; skipped: Array<{ id: string; reason: string }> } {
  const models: MediaRenderModel[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  items.forEach((media, index) => {
    // Only the first image of the first screen is worth loading eagerly.
    const result = buildMediaRenderModel(media, { ...options, priority: options.priority && index === 0 });
    if (result.ok) models.push(result.model);
    else skipped.push({ id: media?.id ?? `index-${index}`, reason: result.reason });
  });

  return { models, skipped };
}
