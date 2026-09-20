-- Migratie 037: dedicated E2E-testaccount (employee-rol, laag geprivilegieerd)
-- Idempotent: veilig meerdere keren uitvoeren.
-- Wachtwoord staat NERGENS in git — alleen de bcrypt-hash hieronder (cost 12, zelfde als
-- AuthService.hashPassword). Het plaintext wachtwoord staat lokaal in .env
-- (E2E_TEST_PASSWORD) en als GitHub-secret, voor gebruik door e2e/login.spec.js.

IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE email = 'e2e-test@vanbommel.internal')
BEGIN
  INSERT INTO dbo.users (email, display_name, role, password_hash, must_set_password)
  VALUES (
    'e2e-test@vanbommel.internal',
    'E2E Test Account',
    'employee',
    '$2b$12$zfwTex1Mp7DOUuaRlxALE.PnZ8L2LrO1frvxaIb94DvtrTrCBx7YK',
    0
  );
END
ELSE
BEGIN
  -- Zorg dat het account bruikbaar blijft: juiste rol/hash, niet vergrendeld.
  UPDATE dbo.users
  SET role = 'employee',
      password_hash = '$2b$12$zfwTex1Mp7DOUuaRlxALE.PnZ8L2LrO1frvxaIb94DvtrTrCBx7YK',
      must_set_password = 0,
      is_locked = 0,
      failed_attempts = 0,
      updated_at = SYSUTCDATETIME()
  WHERE email = 'e2e-test@vanbommel.internal';
END;
