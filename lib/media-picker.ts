import type { PublicMedia } from "./public-cms/contract.ts";

/**
 * The choices a media picker in the editor may offer.
 *
 * A picker that lists every gallery row and previews it through the
 * authenticated image route has two problems. It offers items that cannot
 * actually be published — an editor picks one, saves, and the publish is
 * refused for a reason the picker already knew — and it puts an `/api/` URL in
 * front of the Owner, which is the delivery form the public contract refuses
 * outright.
 *
 * So the options are built from a `resolvePublicMedia` resolution instead: what
 * is offered is exactly what can be served, and the preview uses the same
 * `/assets/media/…` source the public site will use. No storage key, no
 * authenticated route, and nothing selectable that publish would then reject.
 */

export type MediaPickerOption = {
  id: string;
  label: string;
  /** A `/assets/media/…` path, always a raster every client can decode. */
  previewSrc: string;
  width: number;
  height: number;
};

/**
 * The variant a picker thumbnail should use: the small raster if there is one,
 * the large raster otherwise. Never webp or avif — the editor is not the place
 * to discover that a browser cannot decode the preview.
 */
function previewVariant(media: PublicMedia) {
  const rasters = media.variants.filter((variant) => variant.format === "jpeg" || variant.format === "png");
  return rasters.find((variant) => variant.role === "thumbnail") ?? rasters.find((variant) => variant.role === "display") ?? null;
}

export function buildMediaPickerOptions(
  candidates: ReadonlyArray<{ id: string; label: string }>,
  resolved: ReadonlyMap<string, PublicMedia>,
): MediaPickerOption[] {
  const options: MediaPickerOption[] = [];
  for (const candidate of candidates) {
    const media = resolved.get(candidate.id);
    if (!media) continue;
    const variant = previewVariant(media);
    if (!variant) continue;
    options.push({
      id: candidate.id,
      label: candidate.label,
      previewSrc: variant.src,
      width: variant.width,
      height: variant.height,
    });
  }
  return options;
}
