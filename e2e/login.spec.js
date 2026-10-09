'use strict';

// Fase 1/2 van het E2E-voorstel: bewijs dat Playwright Test kan inloggen tegen de echte app
// (browser -> route -> sessie-cookie). Gebruikt een dedicated, laag-geprivilegieerd
// E2E-testaccount (employee-rol, geen adminrechten) — zie scripts/db/migrations/037_seed_e2e_test_user.sql.
// Bewust NIET het echte bootstrap-adminaccount: dat scheidt "test-identiteit" van "echte beheerder"
// en beperkt de impact als de testcredentials ooit uitlekken.
//
// E2E_TEST_EMAIL/E2E_TEST_PASSWORD komen uit env vars — nooit hardcoded, nooit in git.
// Let op: de "ongeldige credentials"-test gebruikt bewust een NIET-bestaand e-mailadres, niet het
// testaccount met een fout wachtwoord — AuthService vergrendelt een account na 3 mislukte pogingen.
const { test, expect } = require('@playwright/test');

const TEST_EMAIL = process.env.E2E_TEST_EMAIL;
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD;

test.describe('Login', () => {
  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    'E2E_TEST_EMAIL / E2E_TEST_PASSWORD niet gezet — zie .env.example'
  );

  test('logt in met geldige testaccount-credentials en bereikt de app-shell', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Email address').fill(TEST_EMAIL);
    await page.getByLabel(/^Password/).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('toont een foutmelding voor een onbekend e-mailadres en blijft op de loginpagina', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Email address').fill('nonexistent-e2e-test@example.invalid');
    await page.getByLabel(/^Password/).fill('irrelevant-password-123');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText(/incorrect/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
