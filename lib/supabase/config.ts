export type SupabaseConfig = {
  url: string;
  publishableKey: string;
};

export function parseSupabaseConfig(urlValue: string | undefined, keyValue: string | undefined): SupabaseConfig | null {
  const rawUrl = urlValue?.trim();
  const publishableKey = keyValue?.trim();
  if (!rawUrl || !publishableKey || !/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(publishableKey)) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return { url: url.origin, publishableKey };
  } catch {
    return null;
  }
}

export function getSupabaseConfig(): SupabaseConfig | null {
  return parseSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function requireSupabaseConfig(): SupabaseConfig {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error("Supabase authentication is not configured.");
  }
  return config;
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}
