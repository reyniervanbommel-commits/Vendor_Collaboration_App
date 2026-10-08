-- Migratie 054: replies op remarks (één niveau) + laatste activiteit per gesprek.
-- Idempotent; statements die nieuwe kolommen raken staan in EXEC (één batch, geen GO).
IF COL_LENGTH('dbo.tb_row_remarks', 'parent_id') IS NULL
BEGIN
  ALTER TABLE dbo.tb_row_remarks ADD parent_id BIGINT NULL;
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = 'FK_tb_row_remarks_parent' AND parent_object_id = OBJECT_ID('dbo.tb_row_remarks')
)
BEGIN
  EXEC(N'ALTER TABLE dbo.tb_row_remarks ADD CONSTRAINT FK_tb_row_remarks_parent
    FOREIGN KEY (parent_id) REFERENCES dbo.tb_row_remarks(id);');
END;

IF COL_LENGTH('dbo.tb_row_remarks', 'last_activity_at') IS NULL
BEGIN
  ALTER TABLE dbo.tb_row_remarks ADD last_activity_at DATETIME2 NULL;
END;

EXEC(N'
  UPDATE dbo.tb_row_remarks SET last_activity_at = created_at WHERE last_activity_at IS NULL;
');

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.tb_row_remarks') AND name = 'last_activity_at' AND is_nullable = 1
)
BEGIN
  EXEC(N'ALTER TABLE dbo.tb_row_remarks ALTER COLUMN last_activity_at DATETIME2 NOT NULL;');
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.default_constraints
  WHERE name = 'DF_tb_row_remarks_last_activity' AND parent_object_id = OBJECT_ID('dbo.tb_row_remarks')
)
BEGIN
  EXEC(N'ALTER TABLE dbo.tb_row_remarks ADD CONSTRAINT DF_tb_row_remarks_last_activity
    DEFAULT (SYSUTCDATETIME()) FOR last_activity_at;');
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_tb_row_remarks_parent' AND object_id = OBJECT_ID('dbo.tb_row_remarks')
)
BEGIN
  EXEC(N'CREATE INDEX IX_tb_row_remarks_parent ON dbo.tb_row_remarks (parent_id)
    INCLUDE (created_at, is_deleted, visibility) WHERE parent_id IS NOT NULL;');
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_tb_row_remarks_thread' AND object_id = OBJECT_ID('dbo.tb_row_remarks')
)
BEGIN
  EXEC(N'CREATE INDEX IX_tb_row_remarks_thread ON dbo.tb_row_remarks
    (table_id, partition_key, record_key, detail_key, last_activity_at DESC, id DESC)
    WHERE parent_id IS NULL;');
END;
