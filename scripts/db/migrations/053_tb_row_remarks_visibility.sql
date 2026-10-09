-- Migratie 053: zichtbaarheid per remark ('vendor' | 'internal').
-- Idempotent; draait bij elke migrate-run. Backfill raakt alleen NULL-rijen.
-- run-migrations.js voert het bestand als één batch uit, dus statements die de nieuwe kolom
-- gebruiken staan in EXEC(N'...') (zelfde patroon als 022).
IF COL_LENGTH('dbo.tb_row_remarks', 'visibility') IS NULL
BEGIN
  ALTER TABLE dbo.tb_row_remarks ADD visibility NVARCHAR(16) NULL;
END;

-- Backfill op huidige rol van de auteur: employee/supply_chain → internal; supplier/admin/onbekend → vendor.
EXEC(N'
  UPDATE r
  SET visibility = CASE WHEN u.role IN (''employee'', ''supply_chain'') THEN ''internal'' ELSE ''vendor'' END
  FROM dbo.tb_row_remarks r
  LEFT JOIN dbo.users u ON u.id = r.created_by
  WHERE r.visibility IS NULL;
');

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.tb_row_remarks') AND name = 'visibility' AND is_nullable = 1
)
BEGIN
  EXEC(N'ALTER TABLE dbo.tb_row_remarks ALTER COLUMN visibility NVARCHAR(16) NOT NULL;');
END;

-- Default alleen voor code die de kolom nog niet kent (rollout: oude versie draait nog tijdens
-- de migratie). Nieuwe code zet visibility altijd expliciet.
IF NOT EXISTS (
  SELECT 1 FROM sys.default_constraints
  WHERE name = 'DF_tb_row_remarks_visibility' AND parent_object_id = OBJECT_ID('dbo.tb_row_remarks')
)
BEGIN
  EXEC(N'ALTER TABLE dbo.tb_row_remarks ADD CONSTRAINT DF_tb_row_remarks_visibility
    DEFAULT (''vendor'') FOR visibility;');
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_tb_row_remarks_visibility' AND parent_object_id = OBJECT_ID('dbo.tb_row_remarks')
)
BEGIN
  EXEC(N'ALTER TABLE dbo.tb_row_remarks ADD CONSTRAINT CK_tb_row_remarks_visibility
    CHECK (visibility IN (''vendor'', ''internal''));');
END;
