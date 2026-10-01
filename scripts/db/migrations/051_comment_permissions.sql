-- Migratie 051: comment-rechten (#AB:328)
-- Idempotent: elke bestaande employee en vendor krijgt de drie rechten als die nog ontbreken.
-- Nieuwe users krijgen ze bij aanmaken (server/utils/commentPermissions.js).

INSERT INTO dbo.user_permissions (user_id, page_name)
SELECT u.id, v.page_name
FROM dbo.users u
CROSS JOIN (VALUES ('comments.view'), ('comments.write'), ('comments.column')) AS v(page_name)
WHERE u.role IN ('employee', 'supplier')
  AND NOT EXISTS (
    SELECT 1 FROM dbo.user_permissions p
    WHERE p.user_id = u.id AND p.page_name = v.page_name
  );
