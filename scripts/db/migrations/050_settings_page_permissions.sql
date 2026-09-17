-- Migratie 050: granulaire instellingen-permissies (#AB:326)
-- Idempotent: veilig meerdere keren uitvoeren.
--
-- 1. Bestaande employees behouden hun huidige STAFF-toegang (Analytics + External links) nu die
--    tabs achter een permissie komen te staan; zonder deze rijen verliezen ze bestaande toegang.
-- 2. De oude, nooit afgedwongen permissie 'admin' verdwijnt uit de catalogus en wordt opgeschoond;
--    er is bewust geen automatische vertaling naar de 8 nieuwe permissies.

INSERT INTO dbo.user_permissions (user_id, page_name)
SELECT u.id, v.page_name
FROM dbo.users u
CROSS JOIN (VALUES ('analytics'), ('external-links')) AS v(page_name)
WHERE u.role = 'employee'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.user_permissions p
    WHERE p.user_id = u.id AND p.page_name = v.page_name
  );

DELETE FROM dbo.user_permissions WHERE page_name = 'admin';
