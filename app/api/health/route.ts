import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getD1 } from "@/db";
import { isCanonicalProductionOriginConfigured } from "@/lib/app-origin";
import { databaseObjectsReady, REQUIRED_DATABASE_OBJECTS, runtimeReadiness } from "@/lib/runtime-readiness";
import { isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = {
    authentication: isSupabaseConfigured(),
    adminAuthentication: isSupabaseAdminConfigured(),
    canonicalOrigin: isCanonicalProductionOriginConfigured(),
    database: false,
    storage: false,
  };

  try {
    const objects = REQUIRED_DATABASE_OBJECTS;
    const result = await getD1()
      .prepare(`SELECT name, type FROM sqlite_schema WHERE name IN (${objects.map(() => "?").join(", ")})`)
      .bind(...objects.map((object) => object.name))
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
