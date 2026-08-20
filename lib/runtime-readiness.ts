export type RuntimeChecks = {
  authentication: boolean;
  adminAuthentication: boolean;
  canonicalOrigin: boolean;
  database: boolean;
  storage: boolean;
};

export const REQUIRED_DATABASE_OBJECTS = [
  { type: "table", name: "companies" },
  { type: "table", name: "gallery_items" },
  { type: "table", name: "gallery_image_variants" },
  { type: "table", name: "user_role_assignments" },
  { type: "table", name: "notifications" },
  { type: "table", name: "trips" },
  { type: "table", name: "trip_motorcycle_assignments" },
  { type: "table", name: "shipping_containers" },
  { type: "table", name: "container_motorcycle_assignments" },
  { type: "table", name: "motorcycle_inspections" },
  { type: "table", name: "site_pages" },
  { type: "table", name: "site_settings_revisions" },
  { type: "table", name: "quote_request_attachments" },
  { type: "index", name: "idx_users_status_display_name_id" },
  { type: "index", name: "uq_quote_requests_request_key" },
  { type: "index", name: "uq_quote_request_attachments_storage_key" },
  { type: "index", name: "uq_quote_request_attachments_quote_checksum" },
  { type: "trigger", name: "trg_user_roles_keep_last_active_owner_update" },
  { type: "trigger", name: "trg_trip_assignments_no_delete" },
  { type: "trigger", name: "trg_container_assignments_no_delete" },
  { type: "trigger", name: "trg_pod_records_no_delete" },
  { type: "trigger", name: "trg_site_settings_revisions_no_delete" },
  { type: "trigger", name: "trg_quote_requests_no_delete" },
  { type: "trigger", name: "trg_quote_requests_public_requirements" },
  { type: "trigger", name: "trg_quote_requests_identity_immutable" },
  { type: "trigger", name: "trg_quote_request_attachments_no_delete" },
  { type: "trigger", name: "trg_quote_request_attachments_immutable" },
] as const;

export function databaseObjectsReady(rows: ReadonlyArray<{ name: string; type: string }>): boolean {
  const found = new Set(rows.map((row) => `${row.type}:${row.name}`));
  return REQUIRED_DATABASE_OBJECTS.every((object) => found.has(`${object.type}:${object.name}`));
}

export function runtimeReadiness(checks: RuntimeChecks) {
  const healthy = Object.values(checks).every(Boolean);
  return {
    statusCode: healthy ? 200 : 503,
    payload: {
      status: healthy ? "healthy" as const : "degraded" as const,
      checks,
    },
  };
}
