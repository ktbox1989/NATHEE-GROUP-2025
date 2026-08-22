/**
 * The application and the public website are two different origins, and mixing
 * them is a security decision rather than a cosmetic one.
 *
 * The public website is a static marketing site on shared hosting. The
 * application holds authenticated sessions, customer records and private media.
 * Putting the application on the apex would make every Auth cookie and every
 * redirect target shared with a document root that Lane A deploys to by file
 * copy, so the application has its own origin.
 *
 * The apex is therefore rejected as an application origin, not merely "not
 * preferred" — it is the most plausible wrong value someone would type.
 */
export const CANONICAL_PRODUCTION_ORIGIN = "https://app.natheegroup2025.com";

/** The public marketing site. Never a valid `APP_ORIGIN`. */
export const PUBLIC_WEBSITE_ORIGIN = "https://natheegroup2025.com";

export function isPublicWebsiteOrigin(value: string | undefined): boolean {
  const normalized = value?.trim().replace(/\/$/, "");
  return normalized === PUBLIC_WEBSITE_ORIGIN || normalized === "http://natheegroup2025.com";
}

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
