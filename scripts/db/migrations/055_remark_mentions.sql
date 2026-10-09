-- Migratie 055: @mentions in remarks — mentionable kolommen, broadcast-groepen en mention-log.
IF COL_LENGTH('dbo.tb_columns', 'mentionable') IS NULL
BEGIN
  ALTER TABLE dbo.tb_columns ADD mentionable BIT NOT NULL
    CONSTRAINT DF_tb_columns_mentionable DEFAULT 0;
  -- Eenmalig bij aanmaken: Artikel (regelniveau) staat standaard aan.
  EXEC(N'
    UPDATE c SET mentionable = 1
    FROM dbo.tb_columns c
    INNER JOIN dbo.tb_tables t ON t.id = c.table_id
    WHERE t.[key] = ''purchase-orders'' AND c.scope = ''detail'' AND c.[key] = ''itemNumber'';
  ');
END;

IF COL_LENGTH('dbo.tb_row_remarks', 'broadcast_id') IS NULL
BEGIN
  ALTER TABLE dbo.tb_row_remarks ADD broadcast_id UNIQUEIDENTIFIER NULL;
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_tb_row_remarks_broadcast' AND object_id = OBJECT_ID('dbo.tb_row_remarks')
)
BEGIN
  EXEC(N'CREATE INDEX IX_tb_row_remarks_broadcast ON dbo.tb_row_remarks (broadcast_id)
    WHERE broadcast_id IS NOT NULL;');
END;

IF OBJECT_ID('dbo.tb_row_remark_mentions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.tb_row_remark_mentions (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tb_row_remark_mentions PRIMARY KEY,
    broadcast_id UNIQUEIDENTIFIER NOT NULL,
    column_id BIGINT NOT NULL CONSTRAINT FK_tb_row_remark_mentions_column REFERENCES dbo.tb_columns(id),
    value NVARCHAR(200) NOT NULL
  );
  CREATE INDEX IX_tb_row_remark_mentions_broadcast ON dbo.tb_row_remark_mentions (broadcast_id);
END;
