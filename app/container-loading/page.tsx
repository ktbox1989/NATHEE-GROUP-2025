import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsPublicPage } from "@/components/cms-public-page";
import { getManagedPageContent, getManagedPageMetadata } from "@/lib/cms-public-route";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { return getManagedPageMetadata("container-loading"); }
export default async function ContainerLoadingPage() { const content = await getManagedPageContent("container-loading"); if (!content) notFound(); return <CmsPublicPage content={content} slug="container-loading" />; }
