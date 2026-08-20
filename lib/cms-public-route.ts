import type { Metadata } from "next";
import {
  DEFAULT_SITE_CONTENT,
  SITE_PAGE_DEFINITIONS,
  getPublishedSitePage,
  type CmsPageContent,
  type SitePageSlug,
} from "@/lib/site-cms";

const productionOrigin = "https://natheegroup2025.com";

export async function getManagedPageMetadata(slug: SitePageSlug): Promise<Metadata> {
  const state = await getPublishedSitePage(slug);
  const content = state.status === "PUBLISHED" ? state.content : DEFAULT_SITE_CONTENT[slug];
  const routePath = SITE_PAGE_DEFINITIONS[slug].path;
  const url = `${productionOrigin}${routePath === "/" ? "/" : `${routePath}/`}`;

  return {
    title: content.seo.title,
    description: content.seo.description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      title: content.seo.title,
      description: content.seo.description,
      url,
      siteName: "NATHEE GROUP 2025",
      type: "website",
      locale: "th_TH",
    },
  };
}

export async function getManagedPageContent(slug: SitePageSlug): Promise<CmsPageContent | null> {
  const state = await getPublishedSitePage(slug);
  if (state.status === "HIDDEN") return null;
  return state.status === "PUBLISHED" ? state.content : DEFAULT_SITE_CONTENT[slug];
}
