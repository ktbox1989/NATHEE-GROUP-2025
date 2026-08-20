import { createClient } from "@supabase/supabase-js";
import { requireSupabaseConfig } from "./config.ts";

export function createSupabaseAdminClient() {
  const { url } = requireSupabaseConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secretKey || !isSupabaseSecretKey(secretKey)) {
    throw new Error("Supabase admin access is not configured.");
  }

  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function isSupabaseAdminConfigured(): boolean {
  return isSupabaseSecretKey(process.env.SUPABASE_SECRET_KEY);
}

export function isSupabaseSecretKey(value: string | undefined): boolean {
  return /^sb_secret_[A-Za-z0-9_-]{16,}$/.test(value?.trim() ?? "");
}
