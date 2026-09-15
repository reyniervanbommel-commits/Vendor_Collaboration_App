-- Migratie 049: tb_columns.vendor_editable — admin bepaalt per kolom of een vendor (leverancier)
-- deze kolom mag bewerken in de PO Table. Los van `writable` (D365-write-back, alleen door de app
-- vanuit staff-acties) en los van `is_active` (zichtbaarheid). Standaard UIT: vendors mogen pas
-- bewerken nadat een admin dit expliciet per kolom aanzet via Admin > Data model.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tb_columns') AND name = 'vendor_editable')
  ALTER TABLE dbo.tb_columns ADD vendor_editable BIT NOT NULL
    CONSTRAINT DF_tb_columns_vendor_editable DEFAULT 0;
