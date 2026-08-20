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

export const USER_ROLES = ["OWNER", "STAFF", "CUSTOMER"] as const;
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
  "documents:read",
  "audit:read",
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
    role: text("role", { enum: USER_ROLES }).notNull(),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    status: text("status", { enum: RECORD_STATUSES }).notNull().default("ACTIVE"),
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
      sql`${table.permission} IN ('companies:read', 'companies:write', 'jobs:read', 'jobs:write', 'motorcycles:read', 'motorcycles:write', 'images:read', 'images:write', 'status:read', 'status:write', 'documents:read', 'audit:read')`,
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
export type MotorcycleStatus = (typeof MOTORCYCLE_STATUSES)[number];
export type ImageCategory = (typeof IMAGE_CATEGORIES)[number];
