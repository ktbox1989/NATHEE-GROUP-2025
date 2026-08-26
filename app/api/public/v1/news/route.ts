import { handlePublicNewsListRequest } from "@/lib/public-news-api-contract";
import { publicNewsApiSource } from "@/lib/public-news-api-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handlePublicNewsListRequest(request, publicNewsApiSource);
}

export async function HEAD(request: Request): Promise<Response> {
  return handlePublicNewsListRequest(request, publicNewsApiSource);
}
