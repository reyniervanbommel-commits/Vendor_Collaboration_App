-- Migratie 038: dedicated E2E-testaccount voor de supplier-rol (data-scoping-test)
-- Idempotent: veilig meerdere keren uitvoeren.
-- vendor_account = 'V000583' — een bestaand vendoraccount met echte PO-data op DEV, nodig om
-- daadwerkelijk te kunnen verifiëren dat een supplier alleen eigen orders ziet (i.p.v. alleen
-- een lege-staat-test). Wachtwoord staat NERGENS in git — alleen de bcrypt-hash hieronder;
-- plaintext staat lokaal in .env (E2E_SUPPLIER_PASSWORD) en als GitHub-secret.

IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE email = 'e2e-test-supplier@vanbommel.internal')
BEGIN
  INSERT INTO dbo.users (email, display_name, role, vendor_account, password_hash, must_set_password)
  VALUES (
    'e2e-test-supplier@vanbommel.internal',
    'E2E Test Supplier',
    'supplier',
    'V000583',
    '$2b$12$3xmUrKWwCDDbVpBdn9QMoecEHFOs6Kgdl/Djo0U3D0s43006xSnZC',
    0
  );
END
ELSE
BEGIN
  UPDATE dbo.users
  SET role = 'supplier',
      vendor_account = 'V000583',
      password_hash = '$2b$12$3xmUrKWwCDDbVpBdn9QMoecEHFOs6Kgdl/Djo0U3D0s43006xSnZC',
      must_set_password = 0,
      is_locked = 0,
      failed_attempts = 0,
      updated_at = SYSUTCDATETIME()
  WHERE email = 'e2e-test-supplier@vanbommel.internal';
END;
