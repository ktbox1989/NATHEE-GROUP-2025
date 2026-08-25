import type { Metadata } from "next";
import { resolvePublicMedia } from "@/lib/public-media-store";
import {
  DEFAULT_SITE_CONTENT,
  SITE_PAGE_DEFINITIONS,
  getPublishedSitePage,
  type CmsPageContent,
  type CmsSection,
  type SitePageSlug,
} from "@/lib/site-cms";
import { getPublishedSiteSettings } from "@/lib/site-settings";

const productionOrigin = "https://natheegroup2025.com";

/**
 * The image a share card shows for a managed page.
 *
 * `CmsPageContent.seo` has no image field, so rather than emit nothing this
 * derives one from the page's own content: the hero image if the page has one,
 * otherwise the first enabled section that carries an image. That is not a
 * guess — it is the photograph the Owner already chose for the top of the page,
 * which is what a share card should show, and the Owner changes it by changing
 * the page.
 *
 * It is resolved through the one delivery contract, so the URL in the card is
 * the same `/assets/media/…` path the page itself renders, and only a PUBLISHED
 * and PUBLIC item can ever appear. An explicit `seo.ogImageItemId` override —
 * for when the share image should differ from the hero — is still an open ask
 * in `docs/LANE_A_ASKS_20260825.md`.
 */
function shareImageItemId(content: CmsPageContent): string | null {
  const enabled = content.sections.filter((section: CmsSection) => section.enabled && section.imageItemId);
  const hero = enabled.find((section: CmsSection) => section.type === "HERO");
  return (hero ?? enabled[0])?.imageItemId ?? null;
}

async function resolveShareImage(content: CmsPageContent): Promise<{ url: string; width: number; height: number } | null> {
  const itemId = shareImageItemId(content);
  if (!itemId) return null;
  try {
    const { getDb } = await import("@/db");
    const { media } = await resolvePublicMedia(getDb(), [itemId]);
    const display = media.get(itemId)?.variants.find((variant) => variant.role === "display" && variant.format === "jpeg");
    // A share card wants the universal raster: several crawlers do not decode
    // webp or avif, and a card with an image they cannot read is worse than a
    // card with none.
    return display ? { url: `${productionOrigin}${display.src}`, width: display.width, height: display.height } : null;
  } catch {
    // Metadata must never be the thing that fails a page render.
    return null;
  }
}

export async function getManagedPageMetadata(slug: SitePageSlug): Promise<Metadata> {
  const [state, settings] = await Promise.all([getPublishedSitePage(slug), getPublishedSiteSettings()]);
  const content = state.status === "PUBLISHED" ? state.content : DEFAULT_SITE_CONTENT[slug];
  const routePath = SITE_PAGE_DEFINITIONS[slug].path;
  const url = `${productionOrigin}${routePath === "/" ? "/" : `${routePath}/`}`;
  const shareImage = await resolveShareImage(content);
  const images = shareImage ? [{ url: shareImage.url, width: shareImage.width, height: shareImage.height }] : undefined;

  return {
    title: content.seo.title,
    description: content.seo.description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      title: content.seo.title,
      description: content.seo.description,
      url,
      siteName: settings.brand.name,
      type: "website",
      locale: "th_TH",
      ...(images ? { images } : {}),
    },
    twitter: {
      // A large card only when there is a real image behind it.
      card: images ? "summary_large_image" : "summary",
      title: content.seo.title,
      description: content.seo.description,
      ...(images ? { images } : {}),
    },
  };
}

export async function getManagedPageContent(slug: SitePageSlug): Promise<CmsPageContent | null> {
  const state = await getPublishedSitePage(slug);
  if (state.status === "HIDDEN") return null;
  return state.status === "PUBLISHED" ? state.content : DEFAULT_SITE_CONTENT[slug];
}
