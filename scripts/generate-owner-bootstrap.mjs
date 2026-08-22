#!/usr/bin/env node
// Generates the one-time SQL that maps a confirmed Supabase identity to the
// canonical application OWNER.
//
// This script takes no secret. A Supabase user UUID is an identifier, not a
// credential, so nothing here may be a password, key or token. It never
// contacts Supabase or D1; it only emits SQL for a reviewed operator to run.
//
// Usage:
//   node scripts/generate-owner-bootstrap.mjs \
//     --auth-id 00000000-0000-4000-8000-000000000000 \
//     --email owner@example.com \
//     --display-name 'Owner name'

import { randomUUID } from "node:crypto";

// Must stay identical to lib/auth-identity.ts, or the mapping this SQL writes
// would be one the runtime refuses to resolve.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

const USAGE = `Usage:
  node scripts/generate-owner-bootstrap.mjs --auth-id <supabase-user-uuid> --email <email> --display-name <name> [--user-id <uuid>]

Arguments:
  --auth-id       Supabase user UUID, already email-confirmed. Required.
  --email         The same confirmed email address. Required.
  --display-name  Human name shown in the application. Required.
  --user-id       Application user id. Optional; a UUID is generated otherwise.
`;

function fail(message) {
  process.stderr.write(`OWNER_BOOTSTRAP_FAIL: ${message}\n\n${USAGE}`);
  process.exit(1);
}

function parseArguments(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`missing value for --${key}`);
    if (parsed.has(key)) fail(`duplicate argument: --${key}`);
    parsed.set(key, value);
    index += 1;
  }
  return parsed;
}

// Every value is validated against a strict pattern before it is quoted, so a
// quoted string can never carry SQL of its own.
function quote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const args = parseArguments(process.argv.slice(2));
for (const key of args.keys()) {
  if (!["auth-id", "email", "display-name", "user-id"].includes(key)) fail(`unknown argument: --${key}`);
}

const authId = (args.get("auth-id") ?? "").trim();
if (!UUID_PATTERN.test(authId)) fail("--auth-id must be the Supabase user UUID");

const email = (args.get("email") ?? "").trim().toLowerCase();
if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) fail("--email must be the confirmed account email");

const displayName = (args.get("display-name") ?? "").trim();
if (displayName.length < 2 || displayName.length > 120) fail("--display-name must be 2-120 characters");
for (const character of displayName) {
  const code = character.codePointAt(0);
  if (code < 0x20 || code === 0x7f) fail("--display-name must not contain control characters");
}

const userId = (args.get("user-id") ?? randomUUID()).trim();
if (!UUID_PATTERN.test(userId)) fail("--user-id must be a UUID");

const auditId = randomUUID();

// Each statement is independently idempotent and guarded, so re-running the
// file is safe and a partially applied run can simply be repeated.
const sql = `-- NATHEE GROUP 2025 — one-time canonical OWNER bootstrap
-- Generated for Supabase identity ${authId}
--
-- Review the PREFLIGHT output before running the INSERTs. Every statement is
-- idempotent: running this file twice changes nothing the second time.
--
-- This file contains no password, key or token. It only maps an identity that
-- must already exist and be email-confirmed in Supabase.

-- PREFLIGHT: expect zero rows before the very first bootstrap.
SELECT 'existing-active-owners' AS check_name, COUNT(*) AS count
FROM users u
LEFT JOIN user_role_assignments r ON r.user_id = u.id
WHERE u.status = 'ACTIVE'
  AND COALESCE(r.role, CASE u.role WHEN 'OWNER' THEN 'OWNER' WHEN 'CUSTOMER' THEN 'CUSTOMER_VIEWER' ELSE 'STAFF' END) = 'OWNER';

-- PREFLIGHT: expect zero rows, otherwise this identity or email is already taken.
SELECT 'conflicting-identity' AS check_name, id, email, role, status
FROM users
WHERE external_auth_id = ${quote(authId)} OR email = ${quote(email)};

-- 1. The application user. Skipped when the identity or email already exists,
--    so an existing account can never be silently rebound to this UUID.
INSERT INTO users (id, external_auth_id, email, display_name, role, status)
SELECT ${quote(userId)}, ${quote(authId)}, ${quote(email)}, ${quote(displayName)}, 'OWNER', 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE external_auth_id = ${quote(authId)})
  AND NOT EXISTS (SELECT 1 FROM users WHERE email = ${quote(email)});

-- 2. The canonical role assignment. The legacy users.role column alone would
--    resolve to OWNER, but the role system treats user_role_assignments as
--    authoritative, so write it explicitly rather than relying on the fallback.
INSERT INTO user_role_assignments (user_id, role, assigned_by)
SELECT u.id, 'OWNER', u.id
FROM users u
WHERE u.external_auth_id = ${quote(authId)}
  AND NOT EXISTS (SELECT 1 FROM user_role_assignments r WHERE r.user_id = u.id);

-- 3. The audit record. Creating the first privileged identity must leave the
--    same evidence trail as every other privileged change.
INSERT INTO audit_logs (id, actor_user_id, company_id, action, entity_type, entity_id, before_json, after_json, reason)
SELECT ${quote(auditId)}, u.id, NULL, 'BOOTSTRAP_OWNER_IDENTITY', 'user', u.id, NULL,
  json_object('role', 'OWNER', 'status', 'ACTIVE', 'externalAuthId', u.external_auth_id),
  'One-time canonical OWNER bootstrap'
FROM users u
WHERE u.external_auth_id = ${quote(authId)}
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs a WHERE a.entity_id = u.id AND a.action = 'BOOTSTRAP_OWNER_IDENTITY'
  );

-- VERIFY: must return exactly one row with effective_role = OWNER and
-- status = ACTIVE. Anything else means the bootstrap did not apply.
SELECT
  u.id AS app_user_id,
  u.external_auth_id,
  u.email,
  u.status,
  COALESCE(r.role, CASE u.role WHEN 'OWNER' THEN 'OWNER' WHEN 'CUSTOMER' THEN 'CUSTOMER_VIEWER' ELSE 'STAFF' END) AS effective_role,
  (SELECT COUNT(*) FROM audit_logs a WHERE a.entity_id = u.id AND a.action = 'BOOTSTRAP_OWNER_IDENTITY') AS audit_entries
FROM users u
LEFT JOIN user_role_assignments r ON r.user_id = u.id
WHERE u.external_auth_id = ${quote(authId)};
`;

process.stdout.write(sql);
process.stderr.write(
  `OWNER_BOOTSTRAP_SQL_READY authId=${authId} appUserId=${userId} statements=4 idempotent=yes secrets=none\n`,
);
