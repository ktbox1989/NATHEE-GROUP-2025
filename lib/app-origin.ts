export const CANONICAL_PRODUCTION_ORIGIN = "https://natheegroup2025.com";

export function normalizeConfiguredAppOrigin(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    const isCanonical = url.origin === CANONICAL_PRODUCTION_ORIGIN;
    const isPreview = url.protocol === "https:" && url.hostname.endsWith(".chatgpt.site");
    const isLocal = (url.hostname === "localhost" || url.hostname === "127.0.0.1") && ["http:", "https:"].includes(url.protocol);
    return isCanonical || isPreview || isLocal ? url.origin : null;
  } catch {
    return null;
  }
}

export function resolveAppOrigin(
  configuredValue: string | undefined,
  requestUrl?: string,
  environment = process.env.NODE_ENV,
): string | null {
  const configured = normalizeConfiguredAppOrigin(configuredValue);
  if (configured) return configured;
  if (environment === "production" || !requestUrl) return null;
  try {
    const requestOrigin = new URL(requestUrl).origin;
    return requestOrigin.startsWith("http://") || requestOrigin.startsWith("https://") ? requestOrigin : null;
  } catch {
    return null;
  }
}

export function getAppOrigin(requestUrl?: string): string | null {
  return resolveAppOrigin(process.env.APP_ORIGIN, requestUrl);
}

export function isCanonicalProductionOriginConfigured(): boolean {
  return normalizeConfiguredAppOrigin(process.env.APP_ORIGIN) === CANONICAL_PRODUCTION_ORIGIN;
}

export function buildAuthCallbackUrl(
  next: string,
  requestUrl?: string,
  configuredValue = process.env.APP_ORIGIN,
  environment = process.env.NODE_ENV,
): URL | null {
  const origin = resolveAppOrigin(configuredValue, requestUrl, environment);
  if (!origin) return null;
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", next);
  return callback;
}
