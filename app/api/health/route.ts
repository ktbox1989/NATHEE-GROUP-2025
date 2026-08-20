import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getD1 } from "@/db";
import { runtimeReadiness } from "@/lib/runtime-readiness";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = {
    authentication: isSupabaseConfigured(),
    database: false,
    storage: Boolean(env.FILES),
  };

  try {
    const result = await getD1()
      .prepare("SELECT 1 AS ready")
      .first<{ ready: number }>();
    checks.database = result?.ready === 1;
  } catch {
    checks.database = false;
  }

  const readiness = runtimeReadiness(checks);
  return NextResponse.json(
    readiness.payload,
    {
      status: readiness.statusCode,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
