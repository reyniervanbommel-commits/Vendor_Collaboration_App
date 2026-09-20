'use strict';

// E2E-scenario 2 uit het voorstel: supplier data-scoping op de echte stack (browser -> route ->
// middleware -> DB), als aanvulling op de al-geteste middleware in isolatie
// (server/middleware/dataAccess.test.js, server/routes/data.test.js).
//
// Testaccount: e2e-test-supplier@vanbommel.internal, vendor_account='V000583' — een bestaand
// vendoraccount met echte PO-data op DEV (zie scripts/db/migrations/038_seed_e2e_supplier_test_user.sql).
// Zonder een account met echte data zou deze test alleen de lege-staat bewijzen, niet de
// daadwerkelijke afscherming tussen suppliers.
const { test, expect } = require('@playwright/test');

const SUPPLIER_EMAIL = process.env.E2E_SUPPLIER_EMAIL;
const SUPPLIER_PASSWORD = process.env.E2E_SUPPLIER_PASSWORD;

test.describe('Supplier data-scoping', () => {
  test.skip(
    !SUPPLIER_EMAIL || !SUPPLIER_PASSWORD,
    'E2E_SUPPLIER_EMAIL / E2E_SUPPLIER_PASSWORD niet gezet — zie .env.example'
  );

  async function loginAsSupplier(page) {
    await page.goto('/login');
    await page.getByLabel('Email address').fill(SUPPLIER_EMAIL);
    await page.getByLabel('Password').fill(SUPPLIER_PASSWORD);
  }

  // Modale welkomstdialoog van de rondleiding maakt de rest van de pagina aria-hidden.
  async function dismissOnboarding(page) {
    const later = page.getByRole('button', { name: 'Maybe later' });
    if (await later.isVisible().catch(() => false)) {
      await later.click();
      await expect(later).toHaveCount(0);
    }
  }

  test('ziet in de board-data uitsluitend orders van het eigen vendorAccount', async ({ page }) => {
    await loginAsSupplier(page);

    const boardResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/data/purchase-orders') && res.request().method() === 'GET'
    );
    await page.getByRole('button', { name: 'Sign in' }).click();
    const boardResponse = await boardResponsePromise;

    expect(boardResponse.ok()).toBe(true);
    const data = await boardResponse.json();
    const rows = data.rows || [];

    // Zonder orders bewijst deze test niets: "geen vreemde rijen" is dan een lege-staat-toeval.
    test.skip(
      rows.length === 0,
      'Testaccount heeft geen zichtbare orders op DEV — controleer vendor_account V000583 en de supplier-filterkolom'
    );
    for (const row of rows) {
      expect(row.values?.vendorAccount).toBe('V000583');
    }
  });

  // /admin is voor een supplier bereikbaar vanwege de persoonlijke General-tab (tabelzoom,
  // SETTINGS_AUDIENCE.ALL). De rolgate zit in de tabs die daar níet staan, niet in een redirect.
  test('ziet op de admin-pagina geen enkele beheertab', async ({ page }) => {
    await loginAsSupplier(page);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();

    await dismissOnboarding(page);
    await page.goto('/admin');
    await dismissOnboarding(page);

    // `exact` onderscheidt de sidebartab "General" van de contentknop "About general settings".
    await expect(page.getByRole('button', { name: 'General', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Users', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Data model', exact: true })).toHaveCount(0);
  });
});
