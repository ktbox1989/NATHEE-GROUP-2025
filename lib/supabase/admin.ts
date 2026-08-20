import { createClient } from "@supabase/supabase-js";
import { requireSupabaseConfig } from "./config";

export function createSupabaseAdminClient() {
  const { url } = requireSupabaseConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("Supabase admin access is not configured.");
  }

  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SECRET_KEY?.trim());
}
