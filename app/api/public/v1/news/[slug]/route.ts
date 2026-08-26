import { handlePublicNewsDetailRequest } from "@/lib/public-news-api-contract";
import { publicNewsApiSource } from "@/lib/public-news-api-service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { slug } = await context.params;
  return handlePublicNewsDetailRequest(request, slug, publicNewsApiSource);
}

export async function HEAD(request: Request, context: Context): Promise<Response> {
  const { slug } = await context.params;
  return handlePublicNewsDetailRequest(request, slug, publicNewsApiSource);
}
