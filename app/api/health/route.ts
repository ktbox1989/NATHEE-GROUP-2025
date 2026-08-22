import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getD1 } from "@/db";
import { isCanonicalProductionOriginConfigured } from "@/lib/app-origin";
import { databaseObjectsReady, runtimeReadiness } from "@/lib/runtime-readiness";
import { isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isTurnstileConfigured } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = {
    authentication: isSupabaseConfigured(),
    adminAuthentication: isSupabaseAdminConfigured(),
    canonicalOrigin: isCanonicalProductionOriginConfigured(),
    database: false,
    storage: false,
    antiAbuse: isTurnstileConfigured(),
  };

  try {
    // Read the schema catalogue rather than binding one parameter per required
    // object: the contract is now every object the migrations create, which is
    // far past D1's per-query parameter ceiling.
    const result = await getD1()
      .prepare("SELECT name, type FROM sqlite_schema WHERE type IN ('table', 'index', 'trigger')")
      .all<{ name: string; type: string }>();
    checks.database = databaseObjectsReady(result.results);
  } catch {
    checks.database = false;
  }

  try {
    await env.FILES.head("__nathee_runtime_readiness_probe__");
    checks.storage = true;
  } catch {
    checks.storage = false;
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
