import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const LEGACY_USER_ROLES = ["OWNER", "STAFF", "CUSTOMER"] as const;
export const INTERNAL_USER_ROLES = [
  "OWNER",
  "ADMIN",
  "STAFF",
  "SALE",
  "WAREHOUSE",
  "CHECKER",
  "DRIVER",
  "ACCOUNTING",
] as const;
export const CUSTOMER_USER_ROLES = ["CUSTOMER_ADMIN", "CUSTOMER_VIEWER"] as const;
export const USER_ROLES = [...INTERNAL_USER_ROLES, ...CUSTOMER_USER_ROLES] as const;
export const STAFF_PERMISSIONS = [
  "companies:read",
  "companies:write",
  "jobs:read",
  "jobs:write",
  "motorcycles:read",
  "motorcycles:write",
  "images:read",
  "images:write",
  "status:read",
  "status:write",
  "yard:read",
  "yard:write",
  "documents:read",
  "audit:read",
  "gallery:read",
  "gallery:write",
  "gallery:publish",
] as const;
export const RECORD_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;
export const JOB_STATUSES = [
  "DRAFT",
  "OPEN",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export const MOTORCYCLE_STATUSES = [
  "PENDING_RECEIPT",
  "RECEIVED",
  "INSPECTED",
  "IN_YARD",
  "SCHEDULED",
  "LOADED",
  "IN_TRANSIT",
  "ARRIVED",
  "DELIVERED",
  "CLOSED",
  "ISSUE",
  "DAMAGED",
  "WAITING_DOCUMENTS",
  "CANCELLED",
] as const;
export const IMAGE_CATEGORIES = [
  "FRONT",
  "REAR",
  "LEFT",
  "RIGHT",
  "DAMAGE",
  "DELIVERY",
  "OTHER",
] as const;
export const QUOTE_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUOTED",
  "ACCEPTED",
  "REJECTED",
  "CANCELLED",
] as const;
export const YARD_ZONE_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export const GALLERY_CATEGORY_STATUSES = ["ACTIVE", "HIDDEN"] as const;
export const GALLERY_ITEM_STATUSES = ["DRAFT", "PUBLISHED", "HIDDEN", "ARCHIVED"] as const;
export const GALLERY_VISIBILITIES = ["PUBLIC", "CUSTOMER_JOB", "INTERNAL"] as const;
export const GALLERY_VARIANT_ROLES = ["ORIGINAL", "DISPLAY", "THUMBNAIL"] as const;
export const NOTIFICATION_TYPES = ["MOTORCYCLE_STATUS_CHANGED"] as const;
export const NOTIFICATION_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
export const TRUCK_TYPES = ["FOUR_WHEEL", "SIX_WHEEL", "OTHER"] as const;
export const TRUCK_STATUSES = ["ACTIVE", "MAINTENANCE", "INACTIVE"] as const;
export const TRIP_STATUSES = ["DRAFT", "PLANNED", "LOADING", "IN_TRANSIT", "ARRIVED", "COMPLETED", "CANCELLED"] as const;
export const TRIP_ASSIGNMENT_STATES = ["ASSIGNED", "LOADED", "UNLOADED", "RELEASED"] as const;

const createdAt = () =>
  text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);
const updatedAt = () =>
  text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`);

export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    legalName: text("legal_name").notNull(),
    displayName: text("display_name").notNull(),
    taxId: text("tax_id"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    status: text("status", { enum: RECORD_STATUSES }).notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_companies_code").on(table.code),
    index("idx_companies_status").on(table.status),
    check(
      "ck_companies_status",
      sql`${table.status} IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')`,
    ),
  ],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    externalAuthId: text("external_auth_id").notNull(),
    email: text("email").notNull(),
    username: text("username"),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: LEGACY_USER_ROLES }).notNull(),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    status: text("status", { enum: RECORD_STATUSES }).notNull().default("ACTIVE"),
    managementRevision: integer("management_revision").notNull().default(0),
    lastManagementRequestId: text("last_management_request_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_users_external_auth_id").on(table.externalAuthId),
    uniqueIndex("uq_users_email").on(table.email),
    uniqueIndex("uq_users_username").on(table.username),
    index("idx_users_company_role").on(table.companyId, table.role),
    index("idx_users_status").on(table.status),
    check(
      "ck_customer_requires_company",
      sql`${table.role} <> 'CUSTOMER' OR ${table.companyId} IS NOT NULL`,
    ),
    check(
      "ck_users_role",
      sql`${table.role} IN ('OWNER', 'STAFF', 'CUSTOMER')`,
    ),
    check(
      "ck_users_status",
      sql`${table.status} IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')`,
    ),
  ],
);

export const userRoleAssignments = sqliteTable(
  "user_role_assignments",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    role: text("role", { enum: USER_ROLES }).notNull(),
    assignedBy: text("assigned_by").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("idx_user_role_assignments_role").on(table.role),
    check(
      "ck_user_role_assignments_role",
      sql`${table.role} IN ('OWNER', 'ADMIN', 'STAFF', 'SALE', 'WAREHOUSE', 'CHECKER', 'DRIVER', 'ACCOUNTING', 'CUSTOMER_ADMIN', 'CUSTOMER_VIEWER')`,
    ),
  ],
);

export const userPermissions = sqliteTable(
  "user_permissions",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    permission: text("permission", { enum: STAFF_PERMISSIONS }).notNull(),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.permission] }),
    index("idx_user_permissions_user").on(table.userId),
    check(
      "ck_user_permissions_permission",
      sql`${table.permission} IN ('companies:read', 'companies:write', 'jobs:read', 'jobs:write', 'motorcycles:read', 'motorcycles:write', 'images:read', 'images:write', 'status:read', 'status:write', 'yard:read', 'yard:write', 'documents:read', 'audit:read', 'gallery:read', 'gallery:write', 'gallery:publish')`,
    ),
  ],
);

export const sequenceCounters = sqliteTable("sequence_counters", {
  name: text("name").primaryKey(),
  value: integer("value").notNull().default(0),
  updatedAt: updatedAt(),
});

export const transportJobs = sqliteTable(
  "transport_jobs",
  {
    id: text("id").primaryKey(),
    jobNumber: text("job_number").notNull(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict", onUpdate: "cascade" }),
    origin: text("origin").notNull(),
    destination: text("destination").notNull(),
    plannedPickupDate: text("planned_pickup_date"),
    plannedDeliveryDate: text("planned_delivery_date"),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("DRAFT"),
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_transport_jobs_job_number").on(table.jobNumber),
    index("idx_transport_jobs_company_created").on(table.companyId, table.createdAt),
    index("idx_transport_jobs_status").on(table.status),
    check(
      "ck_transport_jobs_status",
      sql`${table.status} IN ('DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')`,
    ),
  ],
);

export const trucks = sqliteTable(
  "trucks",
  {
    id: text("id").primaryKey(),
    requestKey: text("request_key").notNull(),
    publicId: text("public_id").notNull(),
    code: text("code").notNull(),
    registration: text("registration"),
    type: text("type", { enum: TRUCK_TYPES }).notNull(),
    capacityMotorcycles: integer("capacity_motorcycles"),
    status: text("status", { enum: TRUCK_STATUSES }).notNull().default("ACTIVE"),
    notes: text("notes"),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_trucks_request_key").on(table.requestKey),
    uniqueIndex("uq_trucks_public_id").on(table.publicId),
    uniqueIndex("uq_trucks_code").on(table.code),
    uniqueIndex("uq_trucks_registration").on(table.registration).where(sql`${table.registration} IS NOT NULL AND ${table.registration} <> ''`),
    index("idx_trucks_status_code").on(table.status, table.code),
    check("ck_trucks_code", sql`length(${table.code}) BETWEEN 2 AND 30 AND ${table.code} NOT GLOB '*[^A-Z0-9-]*'`),
    check("ck_trucks_registration", sql`${table.registration} IS NULL OR length(${table.registration}) BETWEEN 2 AND 30`),
    check("ck_trucks_type", sql`${table.type} IN ('FOUR_WHEEL', 'SIX_WHEEL', 'OTHER')`),
    check("ck_trucks_capacity", sql`${table.capacityMotorcycles} IS NULL OR ${table.capacityMotorcycles} BETWEEN 1 AND 1000`),
    check("ck_trucks_status", sql`${table.status} IN ('ACTIVE', 'MAINTENANCE', 'INACTIVE')`),
  ],
);

export const trips = sqliteTable(
  "trips",
  {
    id: text("id").primaryKey(),
    requestKey: text("request_key").notNull(),
    publicId: text("public_id").notNull(),
    tripNumber: text("trip_number").notNull(),
    truckId: text("truck_id").notNull().references(() => trucks.id, { onDelete: "restrict", onUpdate: "cascade" }),
    driverUserId: text("driver_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    origin: text("origin").notNull(),
    destination: text("destination").notNull(),
    plannedDepartureAt: text("planned_departure_at"),
    plannedArrivalAt: text("planned_arrival_at"),
    actualDepartureAt: text("actual_departure_at"),
    actualArrivalAt: text("actual_arrival_at"),
    status: text("status", { enum: TRIP_STATUSES }).notNull().default("DRAFT"),
    notes: text("notes"),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_trips_request_key").on(table.requestKey),
    uniqueIndex("uq_trips_public_id").on(table.publicId),
    uniqueIndex("uq_trips_trip_number").on(table.tripNumber),
    index("idx_trips_status_planned").on(table.status, table.plannedDepartureAt, table.id),
    index("idx_trips_truck_status").on(table.truckId, table.status, table.plannedDepartureAt),
    index("idx_trips_driver_status").on(table.driverUserId, table.status, table.plannedDepartureAt),
    check("ck_trips_status", sql`${table.status} IN ('DRAFT', 'PLANNED', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'CANCELLED')`),
    check("ck_trips_route", sql`length(${table.origin}) BETWEEN 1 AND 200 AND length(${table.destination}) BETWEEN 1 AND 200`),
    check("ck_trips_planned_order", sql`${table.plannedArrivalAt} IS NULL OR ${table.plannedDepartureAt} IS NULL OR ${table.plannedArrivalAt} >= ${table.plannedDepartureAt}`),
    check("ck_trips_actual_order", sql`${table.actualArrivalAt} IS NULL OR ${table.actualDepartureAt} IS NULL OR ${table.actualArrivalAt} >= ${table.actualDepartureAt}`),
  ],
);

export const tripStatusEvents = sqliteTable(
  "trip_status_events",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id").notNull().references(() => trips.id, { onDelete: "restrict", onUpdate: "cascade" }),
    previousStatus: text("previous_status", { enum: TRIP_STATUSES }),
    newStatus: text("new_status", { enum: TRIP_STATUSES }).notNull(),
    note: text("note"),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_trip_status_events_trip_created").on(table.tripId, table.createdAt),
    check("ck_trip_status_events_previous", sql`${table.previousStatus} IS NULL OR ${table.previousStatus} IN ('DRAFT', 'PLANNED', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'CANCELLED')`),
    check("ck_trip_status_events_new", sql`${table.newStatus} IN ('DRAFT', 'PLANNED', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'CANCELLED')`),
  ],
);

export const motorcycles = sqliteTable(
  "motorcycles",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict", onUpdate: "cascade" }),
    jobId: text("job_id")
      .notNull()
      .references(() => transportJobs.id, { onDelete: "restrict", onUpdate: "cascade" }),
    sequenceNumber: integer("sequence_number").notNull(),
    make: text("make"),
    model: text("model"),
    color: text("color"),
    registration: text("registration"),
    vin: text("vin"),
    engineNumber: text("engine_number"),
    currentStatus: text("current_status", { enum: MOTORCYCLE_STATUSES })
      .notNull()
      .default("PENDING_RECEIPT"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_motorcycles_public_id").on(table.publicId),
    uniqueIndex("uq_motorcycles_job_sequence").on(table.jobId, table.sequenceNumber),
    uniqueIndex("uq_motorcycles_vin")
      .on(table.vin)
      .where(sql`${table.vin} IS NOT NULL AND ${table.vin} <> ''`),
    uniqueIndex("uq_motorcycles_engine_number")
      .on(table.engineNumber)
      .where(sql`${table.engineNumber} IS NOT NULL AND ${table.engineNumber} <> ''`),
    index("idx_motorcycles_company_status").on(table.companyId, table.currentStatus),
    index("idx_motorcycles_job").on(table.jobId),
    index("idx_motorcycles_registration").on(table.registration),
    check("ck_motorcycles_sequence_positive", sql`${table.sequenceNumber} > 0`),
    check(
      "ck_motorcycles_status",
      sql`${table.currentStatus} IN ('PENDING_RECEIPT', 'RECEIVED', 'INSPECTED', 'IN_YARD', 'SCHEDULED', 'LOADED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'CLOSED', 'ISSUE', 'DAMAGED', 'WAITING_DOCUMENTS', 'CANCELLED')`,
    ),
  ],
);

export const tripMotorcycleAssignments = sqliteTable(
  "trip_motorcycle_assignments",
  {
    id: text("id").primaryKey(),
    requestKey: text("request_key").notNull(),
    tripId: text("trip_id").notNull().references(() => trips.id, { onDelete: "restrict", onUpdate: "cascade" }),
    motorcycleId: text("motorcycle_id").notNull().references(() => motorcycles.id, { onDelete: "restrict", onUpdate: "cascade" }),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "restrict", onUpdate: "cascade" }),
    state: text("state", { enum: TRIP_ASSIGNMENT_STATES }).notNull().default("ASSIGNED"),
    assignedBy: text("assigned_by").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    assignedAt: text("assigned_at").notNull(),
    loadedAt: text("loaded_at"),
    unloadedAt: text("unloaded_at"),
    releasedAt: text("released_at"),
    releaseReason: text("release_reason"),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_trip_assignments_request_key").on(table.requestKey),
    uniqueIndex("uq_trip_assignments_motorcycle_active").on(table.motorcycleId).where(sql`${table.releasedAt} IS NULL`),
    index("idx_trip_assignments_trip_state").on(table.tripId, table.state, table.assignedAt),
    index("idx_trip_assignments_company_active").on(table.companyId, table.assignedAt).where(sql`${table.releasedAt} IS NULL`),
    check("ck_trip_assignments_state", sql`${table.state} IN ('ASSIGNED', 'LOADED', 'UNLOADED', 'RELEASED')`),
    check("ck_trip_assignments_release", sql`(${table.state} = 'RELEASED') = (${table.releasedAt} IS NOT NULL)`),
    check("ck_trip_assignments_loaded", sql`${table.state} NOT IN ('LOADED', 'UNLOADED') OR ${table.loadedAt} IS NOT NULL`),
    check("ck_trip_assignments_unloaded", sql`${table.state} <> 'UNLOADED' OR ${table.unloadedAt} IS NOT NULL`),
    check("ck_trip_assignments_time_order", sql`${table.loadedAt} IS NULL OR ${table.loadedAt} >= ${table.assignedAt}`),
    check("ck_trip_assignments_unload_order", sql`${table.unloadedAt} IS NULL OR (${table.loadedAt} IS NOT NULL AND ${table.unloadedAt} >= ${table.loadedAt})`),
    check("ck_trip_assignments_release_reason", sql`${table.state} <> 'RELEASED' OR length(${table.releaseReason}) BETWEEN 3 AND 500`),
  ],
);

export const yardZones = sqliteTable(
  "yard_zones",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    capacity: integer("capacity"),
    status: text("status", { enum: YARD_ZONE_STATUSES }).notNull().default("ACTIVE"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_yard_zones_code").on(table.code),
    index("idx_yard_zones_status_code").on(table.status, table.code),
    check("ck_yard_zones_code", sql`length(${table.code}) BETWEEN 2 AND 30`),
    check("ck_yard_zones_capacity", sql`${table.capacity} IS NULL OR ${table.capacity} > 0`),
    check("ck_yard_zones_status", sql`${table.status} IN ('ACTIVE', 'INACTIVE')`),
  ],
);

export const yardPlacements = sqliteTable(
  "yard_placements",
  {
    id: text("id").primaryKey(),
    requestKey: text("request_key").notNull(),
    motorcycleId: text("motorcycle_id")
      .notNull()
      .references(() => motorcycles.id, { onDelete: "restrict", onUpdate: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict", onUpdate: "cascade" }),
    yardZoneId: text("yard_zone_id")
      .notNull()
      .references(() => yardZones.id, { onDelete: "restrict", onUpdate: "cascade" }),
    enteredAt: text("entered_at").notNull(),
    exitedAt: text("exited_at"),
    placedBy: text("placed_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_yard_placements_request_key").on(table.requestKey),
    uniqueIndex("uq_yard_placements_motorcycle_active")
      .on(table.motorcycleId)
      .where(sql`${table.exitedAt} IS NULL`),
    index("idx_yard_placements_zone_active")
      .on(table.yardZoneId, table.enteredAt)
      .where(sql`${table.exitedAt} IS NULL`),
    index("idx_yard_placements_company_entered").on(table.companyId, table.enteredAt),
    index("idx_yard_placements_motorcycle_entered").on(table.motorcycleId, table.enteredAt),
    check(
      "ck_yard_placements_time_order",
      sql`${table.exitedAt} IS NULL OR ${table.exitedAt} >= ${table.enteredAt}`,
    ),
  ],
);

export const motorcycleImages = sqliteTable(
  "motorcycle_images",
  {
    id: text("id").primaryKey(),
    motorcycleId: text("motorcycle_id")
      .notNull()
      .references(() => motorcycles.id, { onDelete: "restrict", onUpdate: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict", onUpdate: "cascade" }),
    storageKey: text("storage_key").notNull(),
    category: text("category", { enum: IMAGE_CATEGORIES }).notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    checksum: text("checksum"),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_motorcycle_images_storage_key").on(table.storageKey),
    index("idx_motorcycle_images_motorcycle_created").on(table.motorcycleId, table.createdAt),
    index("idx_motorcycle_images_company").on(table.companyId),
    check(
      "ck_motorcycle_images_category",
      sql`${table.category} IN ('FRONT', 'REAR', 'LEFT', 'RIGHT', 'DAMAGE', 'DELIVERY', 'OTHER')`,
    ),
    check("ck_motorcycle_images_size_positive", sql`${table.byteSize} > 0`),
  ],
);

export const galleryCategories = sqliteTable(
  "gallery_categories",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", { enum: GALLERY_CATEGORY_STATUSES }).notNull().default("ACTIVE"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_gallery_categories_slug").on(table.slug),
    index("idx_gallery_categories_status_sort").on(table.status, table.sortOrder, table.name),
    check("ck_gallery_categories_slug", sql`length(${table.slug}) BETWEEN 2 AND 80 AND ${table.slug} NOT GLOB '*[^a-z0-9-]*'`),
    check("ck_gallery_categories_name", sql`length(${table.name}) BETWEEN 1 AND 120`),
    check("ck_gallery_categories_status", sql`${table.status} IN ('ACTIVE', 'HIDDEN')`),
    check("ck_gallery_categories_sort", sql`${table.sortOrder} >= 0`),
  ],
);

export const galleryItems = sqliteTable(
  "gallery_items",
  {
    id: text("id").primaryKey(),
    requestKey: text("request_key").notNull(),
    categoryId: text("category_id").notNull().references(() => galleryCategories.id, { onDelete: "restrict", onUpdate: "cascade" }),
    companyId: text("company_id").references(() => companies.id, { onDelete: "restrict", onUpdate: "cascade" }),
    jobId: text("job_id").references(() => transportJobs.id, { onDelete: "restrict", onUpdate: "cascade" }),
    title: text("title").notNull(),
    caption: text("caption"),
    altText: text("alt_text").notNull(),
    takenAt: text("taken_at"),
    location: text("location"),
    publicJobReference: text("public_job_reference"),
    status: text("status", { enum: GALLERY_ITEM_STATUSES }).notNull().default("DRAFT"),
    visibility: text("visibility", { enum: GALLERY_VISIBILITIES }).notNull().default("INTERNAL"),
    sortOrder: integer("sort_order").notNull().default(0),
    isFeatured: integer("is_featured").notNull().default(0),
    uploadedBy: text("uploaded_by").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    publishedBy: text("published_by").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    publishedAt: text("published_at"),
    archivedAt: text("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_gallery_items_request_key").on(table.requestKey),
    index("idx_gallery_items_public_order").on(table.visibility, table.status, table.isFeatured, table.sortOrder, table.createdAt),
    index("idx_gallery_items_category_order").on(table.categoryId, table.status, table.sortOrder, table.createdAt),
    index("idx_gallery_items_company_job").on(table.companyId, table.jobId, table.status, table.createdAt),
    check("ck_gallery_items_title", sql`length(${table.title}) BETWEEN 1 AND 160`),
    check("ck_gallery_items_alt", sql`length(${table.altText}) BETWEEN 3 AND 300`),
    check("ck_gallery_items_location", sql`${table.location} IS NULL OR length(${table.location}) <= 200`),
    check("ck_gallery_items_public_job_reference", sql`${table.publicJobReference} IS NULL OR length(${table.publicJobReference}) <= 100`),
    check("ck_gallery_items_status", sql`${table.status} IN ('DRAFT', 'PUBLISHED', 'HIDDEN', 'ARCHIVED')`),
    check("ck_gallery_items_visibility", sql`${table.visibility} IN ('PUBLIC', 'CUSTOMER_JOB', 'INTERNAL')`),
    check("ck_gallery_items_sort", sql`${table.sortOrder} >= 0`),
    check("ck_gallery_items_featured", sql`${table.isFeatured} IN (0, 1)`),
    check("ck_gallery_items_customer_scope", sql`${table.visibility} <> 'CUSTOMER_JOB' OR (${table.companyId} IS NOT NULL AND ${table.jobId} IS NOT NULL)`),
    check("ck_gallery_items_public_scope", sql`${table.visibility} <> 'PUBLIC' OR (${table.companyId} IS NULL AND ${table.jobId} IS NULL)`),
    check("ck_gallery_items_published_actor", sql`${table.status} <> 'PUBLISHED' OR (${table.publishedBy} IS NOT NULL AND ${table.publishedAt} IS NOT NULL)`),
  ],
);

export const galleryImageVariants = sqliteTable(
  "gallery_image_variants",
  {
    id: text("id").primaryKey(),
    galleryItemId: text("gallery_item_id").notNull().references(() => galleryItems.id, { onDelete: "restrict", onUpdate: "cascade" }),
    role: text("role", { enum: GALLERY_VARIANT_ROLES }).notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    width: integer("width"),
    height: integer("height"),
    byteSize: integer("byte_size").notNull(),
    checksum: text("checksum").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_gallery_image_variants_storage_key").on(table.storageKey),
    uniqueIndex("uq_gallery_image_variants_item_role_type").on(table.galleryItemId, table.role, table.contentType),
    index("idx_gallery_image_variants_item_role").on(table.galleryItemId, table.role),
    check("ck_gallery_image_variants_role", sql`${table.role} IN ('ORIGINAL', 'DISPLAY', 'THUMBNAIL')`),
    check("ck_gallery_image_variants_content_type", sql`${table.contentType} IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif')`),
    check("ck_gallery_image_variants_size", sql`${table.byteSize} > 0`),
    check("ck_gallery_image_variants_width", sql`${table.width} IS NULL OR ${table.width} > 0`),
    check("ck_gallery_image_variants_height", sql`${table.height} IS NULL OR ${table.height} > 0`),
    check("ck_gallery_image_variants_checksum", sql`length(${table.checksum}) = 64 AND ${table.checksum} NOT GLOB '*[^0-9a-f]*'`),
  ],
);

export const statusEvents = sqliteTable(
  "status_events",
  {
    id: text("id").primaryKey(),
    motorcycleId: text("motorcycle_id")
      .notNull()
      .references(() => motorcycles.id, { onDelete: "restrict", onUpdate: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict", onUpdate: "cascade" }),
    previousStatus: text("previous_status", { enum: MOTORCYCLE_STATUSES }),
    newStatus: text("new_status", { enum: MOTORCYCLE_STATUSES }).notNull(),
    note: text("note"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_status_events_motorcycle_created").on(table.motorcycleId, table.createdAt),
    index("idx_status_events_company_created").on(table.companyId, table.createdAt),
    check(
      "ck_status_events_previous_status",
      sql`${table.previousStatus} IS NULL OR ${table.previousStatus} IN ('PENDING_RECEIPT', 'RECEIVED', 'INSPECTED', 'IN_YARD', 'SCHEDULED', 'LOADED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'CLOSED', 'ISSUE', 'DAMAGED', 'WAITING_DOCUMENTS', 'CANCELLED')`,
    ),
    check(
      "ck_status_events_new_status",
      sql`${table.newStatus} IN ('PENDING_RECEIPT', 'RECEIVED', 'INSPECTED', 'IN_YARD', 'SCHEDULED', 'LOADED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'CLOSED', 'ISSUE', 'DAMAGED', 'WAITING_DOCUMENTS', 'CANCELLED')`,
    ),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict", onUpdate: "cascade" }),
    sourceEventId: text("source_event_id")
      .notNull()
      .references(() => statusEvents.id, { onDelete: "restrict", onUpdate: "cascade" }),
    type: text("type", { enum: NOTIFICATION_TYPES }).notNull(),
    severity: text("severity", { enum: NOTIFICATION_SEVERITIES }).notNull().default("INFO"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href").notNull(),
    readAt: text("read_at"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_notifications_idempotency_key").on(table.idempotencyKey),
    index("idx_notifications_recipient_created").on(table.recipientUserId, table.createdAt, table.id),
    index("idx_notifications_recipient_unread")
      .on(table.recipientUserId, table.createdAt)
      .where(sql`${table.readAt} IS NULL`),
    index("idx_notifications_source_event").on(table.sourceEventId),
    check("ck_notifications_type", sql`${table.type} IN ('MOTORCYCLE_STATUS_CHANGED')`),
    check("ck_notifications_severity", sql`${table.severity} IN ('INFO', 'WARNING', 'CRITICAL')`),
    check("ck_notifications_title", sql`length(${table.title}) BETWEEN 1 AND 160`),
    check("ck_notifications_body", sql`length(${table.body}) BETWEEN 1 AND 500`),
    check("ck_notifications_href", sql`length(${table.href}) BETWEEN 6 AND 500 AND ${table.href} LIKE '/app/%'`),
  ],
);

export const quoteRequests = sqliteTable(
  "quote_requests",
  {
    id: text("id").primaryKey(),
    requestNumber: text("request_number").notNull(),
    companyName: text("company_name"),
    contactName: text("contact_name").notNull(),
    phone: text("phone").notNull(),
    lineId: text("line_id"),
    email: text("email"),
    origin: text("origin").notNull(),
    destination: text("destination").notNull(),
    quantity: integer("quantity").notNull(),
    vehicleType: text("vehicle_type"),
    desiredDate: text("desired_date"),
    extrasJson: text("extras_json").notNull().default("[]"),
    notes: text("notes"),
    status: text("status", { enum: QUOTE_STATUSES }).notNull().default("NEW"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_quote_requests_request_number").on(table.requestNumber),
    index("idx_quote_requests_status_created").on(table.status, table.createdAt),
    check("ck_quote_requests_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "ck_quote_requests_status",
      sql`${table.status} IN ('NEW', 'CONTACTED', 'QUOTED', 'ACCEPTED', 'REJECTED', 'CANCELLED')`,
    ),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_audit_logs_entity_created").on(table.entityType, table.entityId, table.createdAt),
    index("idx_audit_logs_company_created").on(table.companyId, table.createdAt),
  ],
);

export type UserRole = (typeof USER_ROLES)[number];
export type LegacyUserRole = (typeof LEGACY_USER_ROLES)[number];
export type MotorcycleStatus = (typeof MOTORCYCLE_STATUSES)[number];
export type ImageCategory = (typeof IMAGE_CATEGORIES)[number];
export type YardZoneStatus = (typeof YARD_ZONE_STATUSES)[number];
export type GalleryItemStatus = (typeof GALLERY_ITEM_STATUSES)[number];
export type GalleryVisibility = (typeof GALLERY_VISIBILITIES)[number];
export type GalleryVariantRole = (typeof GALLERY_VARIANT_ROLES)[number];
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];
export type TruckType = (typeof TRUCK_TYPES)[number];
export type TruckStatus = (typeof TRUCK_STATUSES)[number];
export type TripStatus = (typeof TRIP_STATUSES)[number];
export type TripAssignmentState = (typeof TRIP_ASSIGNMENT_STATES)[number];
