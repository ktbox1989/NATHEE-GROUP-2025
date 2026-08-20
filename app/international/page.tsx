import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsPublicPage } from "@/components/cms-public-page";
import { getManagedPageContent, getManagedPageMetadata } from "@/lib/cms-public-route";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { return getManagedPageMetadata("international"); }
export default async function InternationalPage() { const content = await getManagedPageContent("international"); if (!content) notFound(); return <CmsPublicPage content={content} slug="international" />; }
