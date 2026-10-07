-- Migratie 052: rol supply_chain toestaan.
-- Idempotent: de constraint wordt alleen vervangen als supply_chain er nog niet in staat.
IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_users_role_allowed' AND parent_object_id = OBJECT_ID('dbo.users')
    AND definition NOT LIKE '%supply_chain%'
)
BEGIN
  ALTER TABLE dbo.users DROP CONSTRAINT CK_users_role_allowed;
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_users_role_allowed' AND parent_object_id = OBJECT_ID('dbo.users')
)
BEGIN
  ALTER TABLE dbo.users ADD CONSTRAINT CK_users_role_allowed
    CHECK (role IN ('admin', 'employee', 'supply_chain', 'supplier'));
END;

-- Supply Chain krijgt dezelfde default comment-rechten als employee (zie migratie 051).
INSERT INTO dbo.user_permissions (user_id, page_name)
SELECT u.id, v.page_name
FROM dbo.users u
CROSS JOIN (VALUES ('comments.view'), ('comments.write'), ('comments.column')) AS v(page_name)
WHERE u.role = 'supply_chain'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.user_permissions p WHERE p.user_id = u.id AND p.page_name = v.page_name
  );
