import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsPublicPage } from "@/components/cms-public-page";
import { getManagedPageContent, getManagedPageMetadata } from "@/lib/cms-public-route";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { return getManagedPageMetadata("dealer-fleet"); }
export default async function DealerFleetPage() { const content = await getManagedPageContent("dealer-fleet"); if (!content) notFound(); return <CmsPublicPage content={content} slug="dealer-fleet" />; }
