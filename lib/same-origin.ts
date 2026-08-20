import type { NextRequest } from "next/server";
import { resolveAppOrigin } from "./app-origin.ts";

export function isSameOrigin(
  request: NextRequest,
  configuredOrigin = process.env.APP_ORIGIN,
  environment = process.env.NODE_ENV,
): boolean {
  const expectedOrigin = resolveAppOrigin(configuredOrigin, request.url, environment);
  if (!expectedOrigin || new URL(request.url).origin !== expectedOrigin) return false;
  const origin = request.headers.get("origin");
  if (origin) return origin === expectedOrigin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}
