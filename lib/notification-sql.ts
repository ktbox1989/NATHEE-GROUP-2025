export const STATUS_NOTIFICATION_INSERT_SQL = `
  INSERT INTO notifications
    (id, idempotency_key, recipient_user_id, company_id, source_event_id,
     type, severity, title, body, href, read_at, created_at)
  SELECT
    'ntf_' || lower(hex(randomblob(16))),
    'status:' || ? || ':' || u.id,
    u.id,
    e.company_id,
    e.id,
    'MOTORCYCLE_STATUS_CHANGED',
    ?,
    ?,
    ?,
    ?,
    NULL,
    ?
  FROM users u
  LEFT JOIN user_role_assignments r ON r.user_id = u.id
  LEFT JOIN user_permissions p ON p.user_id = u.id AND p.permission = 'status:read'
  JOIN status_events e ON e.id = ?
  WHERE u.status = 'ACTIVE'
    AND u.id <> e.created_by
    AND (
      COALESCE(
        r.role,
        CASE u.role WHEN 'OWNER' THEN 'OWNER' WHEN 'CUSTOMER' THEN 'CUSTOMER_VIEWER' ELSE 'STAFF' END
      ) = 'OWNER'
      OR (
        COALESCE(
          r.role,
          CASE u.role WHEN 'OWNER' THEN 'OWNER' WHEN 'CUSTOMER' THEN 'CUSTOMER_VIEWER' ELSE 'STAFF' END
        ) IN ('ADMIN', 'STAFF', 'SALE', 'WAREHOUSE', 'CHECKER', 'DRIVER', 'ACCOUNTING')
        AND p.permission IS NOT NULL
      )
      OR (
        COALESCE(
          r.role,
          CASE u.role WHEN 'OWNER' THEN 'OWNER' WHEN 'CUSTOMER' THEN 'CUSTOMER_VIEWER' ELSE 'STAFF' END
        ) IN ('CUSTOMER_ADMIN', 'CUSTOMER_VIEWER')
        AND u.company_id = e.company_id
      )
    )
  ON CONFLICT(idempotency_key) DO NOTHING
`;
