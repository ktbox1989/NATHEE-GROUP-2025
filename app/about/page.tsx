import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsPublicPage } from "@/components/cms-public-page";
import { DEFAULT_SITE_CONTENT, getPublishedSitePage } from "@/lib/site-cms";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { const state = await getPublishedSitePage("about"); const content = state.status === "PUBLISHED" ? state.content : DEFAULT_SITE_CONTENT.about; const url = "https://natheegroup2025.com/about/"; return { title: content.seo.title, description: content.seo.description, alternates: { canonical: url }, openGraph: { title: content.seo.title, description: content.seo.description, url, siteName: "NATHEE GROUP 2025", type: "website", locale: "th_TH" } }; }
export default async function AboutPage() { const state = await getPublishedSitePage("about"); if (state.status === "HIDDEN") notFound(); return <CmsPublicPage content={state.status === "PUBLISHED" ? state.content : DEFAULT_SITE_CONTENT.about} slug="about" />; }
