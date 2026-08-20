import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsPublicPage } from "@/components/cms-public-page";
import { DEFAULT_SITE_CONTENT, getPublishedSitePage } from "@/lib/site-cms";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { const state = await getPublishedSitePage("contact"); const content = state.status === "PUBLISHED" ? state.content : DEFAULT_SITE_CONTENT.contact; const url = "https://natheegroup2025.com/contact/"; return { title: content.seo.title, description: content.seo.description, alternates: { canonical: url }, openGraph: { title: content.seo.title, description: content.seo.description, url, siteName: "NATHEE GROUP 2025", type: "website", locale: "th_TH" } }; }
export default async function ContactPage() { const state = await getPublishedSitePage("contact"); if (state.status === "HIDDEN") notFound(); return <CmsPublicPage content={state.status === "PUBLISHED" ? state.content : DEFAULT_SITE_CONTENT.contact} slug="contact" />; }
