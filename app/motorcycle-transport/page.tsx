import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsPublicPage } from "@/components/cms-public-page";
import { getManagedPageContent, getManagedPageMetadata } from "@/lib/cms-public-route";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { return getManagedPageMetadata("motorcycle-transport"); }
export default async function MotorcycleTransportPage() { const content = await getManagedPageContent("motorcycle-transport"); if (!content) notFound(); return <CmsPublicPage content={content} slug="motorcycle-transport" />; }
