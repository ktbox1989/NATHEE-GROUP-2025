export type RuntimeChecks = {
  authentication: boolean;
  adminAuthentication: boolean;
  canonicalOrigin: boolean;
  database: boolean;
  storage: boolean;
  antiAbuse: boolean;
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
  { type: "table", name: "motorcycle_import_batches" },
  { type: "table", name: "motorcycle_import_rows" },
  { type: "table", name: "motorcycle_image_variants" },
  { type: "table", name: "proof_of_delivery_signatures" },
  // Without this table the Auth routes refuse every request, so a runtime
  // missing migration 0022 is degraded rather than quietly unthrottled.
  { type: "table", name: "auth_attempt_counters" },
  // Without this table a recovery link cannot attest a password change, and the
  // reset page would fall back to demanding a password the user does not have.
  { type: "table", name: "auth_recovery_grants" },
  { type: "index", name: "idx_users_status_display_name_id" },
  { type: "index", name: "uq_quote_requests_request_key" },
  { type: "index", name: "uq_quote_request_attachments_storage_key" },
  { type: "index", name: "uq_quote_request_attachments_quote_checksum" },
  { type: "index", name: "uq_motorcycle_import_batches_job_checksum" },
  { type: "index", name: "idx_motorcycle_import_rows_batch_status_row" },
  { type: "index", name: "uq_transport_jobs_public_id" },
  { type: "index", name: "uq_yard_zones_public_id" },
  { type: "index", name: "idx_audit_logs_created_id" },
  { type: "index", name: "uq_motorcycle_images_request_key" },
  { type: "index", name: "idx_auth_attempt_counters_updated" },
  { type: "index", name: "idx_auth_recovery_grants_expires" },
  { type: "index", name: "idx_audit_logs_action_created" },
  // A trail that can be edited or erased is not evidence of anything.
  { type: "trigger", name: "trg_audit_logs_no_update" },
  { type: "trigger", name: "trg_audit_logs_no_delete" },
  { type: "trigger", name: "trg_user_roles_keep_last_active_owner_update" },
  { type: "trigger", name: "trg_trip_assignments_no_delete" },
  { type: "trigger", name: "trg_container_assignments_no_delete" },
  { type: "trigger", name: "trg_pod_records_no_delete" },
  { type: "trigger", name: "trg_pod_records_require_signature_flag_insert" },
  { type: "trigger", name: "trg_pod_signatures_validate_insert" },
  { type: "trigger", name: "trg_pod_signatures_no_update" },
  { type: "trigger", name: "trg_pod_signatures_no_delete" },
  { type: "trigger", name: "trg_motorcycles_require_new_pod_signature" },
  { type: "trigger", name: "trg_site_settings_revisions_no_delete" },
  { type: "trigger", name: "trg_quote_requests_no_delete" },
  { type: "trigger", name: "trg_quote_requests_public_requirements" },
  { type: "trigger", name: "trg_quote_requests_identity_immutable" },
  { type: "trigger", name: "trg_quote_request_attachments_no_delete" },
  { type: "trigger", name: "trg_quote_request_attachments_immutable" },
  { type: "trigger", name: "trg_motorcycle_import_batches_no_delete" },
  { type: "trigger", name: "trg_motorcycle_import_batches_transition" },
  { type: "trigger", name: "trg_motorcycle_import_rows_no_delete" },
  { type: "trigger", name: "trg_motorcycle_import_rows_transition" },
  { type: "trigger", name: "trg_motorcycle_images_no_delete" },
  { type: "trigger", name: "trg_motorcycle_images_immutable" },
  { type: "trigger", name: "trg_motorcycle_image_variants_no_delete" },
  { type: "trigger", name: "trg_motorcycle_image_variants_immutable" },
  { type: "trigger", name: "trg_transport_jobs_public_id_insert" },
  { type: "trigger", name: "trg_transport_jobs_public_id_immutable" },
  { type: "trigger", name: "trg_yard_zones_public_id_insert" },
  { type: "trigger", name: "trg_yard_zones_public_id_immutable" },
  { type: "trigger", name: "trg_trucks_public_id_insert" },
  { type: "trigger", name: "trg_trucks_public_id_immutable" },
  { type: "trigger", name: "trg_trips_public_id_insert" },
  { type: "trigger", name: "trg_trips_public_id_immutable" },
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
