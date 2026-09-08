-- Migratie 048: tb_columns.original_label — bewaart het label zoals het was bij het aanmaken van
-- de kolom (D365-bronveld of custom), onafhankelijk van latere hernoemingen door gebruikers.
-- Zo kan de UI bij hover altijd tonen waar een kolom oorspronkelijk vandaan kwam, ook na een rename.
-- Idempotent + non-destructief. Geen GO-batches (migratierunner voert het bestand als één batch uit).
-- ALTER + referentie aan de nieuwe kolom staan in dezelfde batch; via EXEC dwingen we een apart
-- compile-moment af zodat SQL Server de kolom kent zodra hij (idempotent) is toegevoegd.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tb_columns') AND name = 'original_label')
  EXEC('ALTER TABLE dbo.tb_columns ADD original_label NVARCHAR(128) NULL');

-- Backfill: voor bestaande rijen is het huidige label de beste beschikbare "oorspronkelijke" waarde.
EXEC('UPDATE dbo.tb_columns SET original_label = label WHERE original_label IS NULL');

-- Trigger: zet original_label automatisch bij elke nieuwe rij (via elk insert-pad: services,
-- seed-migraties, TableBuilder), zonder dat elke insert-plek aangepast moet worden. Rename-updates
-- raken original_label niet (die zetten alleen label), dus de oorspronkelijke waarde blijft staan.
-- CREATE TRIGGER moet het eerste statement in zijn batch zijn — via EXEC in dynamische SQL omzeilen
-- we dat zonder GO (de migratierunner splitst niet op GO).
IF EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'trg_tb_columns_original_label')
  EXEC('DROP TRIGGER trg_tb_columns_original_label');

EXEC('
CREATE TRIGGER trg_tb_columns_original_label ON dbo.tb_columns
AFTER INSERT
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE c
    SET c.original_label = i.label
    FROM dbo.tb_columns c
    INNER JOIN inserted i ON i.id = c.id
    WHERE c.original_label IS NULL;
END
');
