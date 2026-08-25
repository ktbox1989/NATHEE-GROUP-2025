import type { PublicMedia } from "@/lib/public-cms/contract";
import { buildMediaRenderModel } from "@/lib/public-cms/media";

/**
 * One `PublicMedia`, rendered.
 *
 * The decisions are all in `buildMediaRenderModel`, which was written before
 * anything called it: which variants are usable, which raster format the image
 * element falls back to, the intrinsic dimensions that stop the page reflowing,
 * and the refusal to render at all when the media has no alt text or no raster
 * fallback. This component is the JSX around that model and no policy of its
 * own, so the rules cannot drift between a post and a page.
 *
 * Returning null on refusal is deliberate: a broken image on a public page
 * looks worse than no image, and the reason is already reported to the editor
 * at publish time by `resolvePublicMedia`.
 */
export function PublicMediaImage({
  media,
  sizes,
  priority = false,
  className,
  withOrientation = false,
}: {
  media: PublicMedia;
  sizes?: string;
  priority?: boolean;
  className?: string;
  /** Sets `data-orientation`, which the CMS image styles switch object-fit on. */
  withOrientation?: boolean;
}) {
  const result = buildMediaRenderModel(media, { sizes, priority, lightbox: false });
  if (!result.ok) return null;
  const { img, sources, orientation } = result.model;

  return (
    <picture className={className} {...(withOrientation ? { "data-orientation": orientation } : {})}>
      {sources.map((source) => (
        <source key={source.type} type={source.type} srcSet={source.srcset} sizes={source.sizes} />
      ))}
      {/* The delivery contract builds the src; next/image would rewrite it. */}
      <img
        src={img.src}
        srcSet={img.srcset}
        sizes={img.sizes}
        alt={img.alt}
        width={img.width}
        height={img.height}
        loading={img.loading}
        decoding="async"
        {...(img.fetchpriority ? { fetchPriority: img.fetchpriority } : {})}
      />
    </picture>
  );
}
