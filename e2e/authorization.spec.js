'use strict';

// Autorisatie op de echte stack: inloggen als vendor respectievelijk employee en daarna met de
// verkregen sessiecookie rechtstreeks de API bevragen. De unit-/routetests bewijzen de guards in
// isolatie; deze suite bewijst dat de keten browser -> sessie -> middleware -> DB ook echt dichtzit.
//
// Veilig tegen DEV: alle mutatiepogingen richten zich op user-id 999999 (bestaat niet). Wordt een
// guard ooit verkeerd gezet, dan raakt de test geen echte gebruiker maar valt hij door de mand op
// een 404 in plaats van een 403.
const { test, expect } = require('@playwright/test');

const VENDOR_EMAIL = process.env.E2E_SUPPLIER_EMAIL;
const VENDOR_PASSWORD = process.env.E2E_SUPPLIER_PASSWORD;
const EMPLOYEE_EMAIL = process.env.E2E_TEST_EMAIL;
const EMPLOYEE_PASSWORD = process.env.E2E_TEST_PASSWORD;

const NON_EXISTENT_USER_ID = 999999;

// Een account dat de rondleiding nog niet heeft gezien krijgt een modale welkomstdialoog. Die
// maakt de rest van de pagina aria-hidden, waardoor assertions op de sidebar er niet doorheen
// komen. Wegklikken hoort dus bij inloggen, niet bij de losse tests.
async function dismissOnboarding(page) {
  const later = page.getByRole('button', { name: 'Maybe later' });
  if (await later.isVisible().catch(() => false)) {
    await later.click();
    await expect(later).toHaveCount(0);
  }
}

// De instellingen-sidebar verschijnt pas nadat /auth/me de rol en permissies heeft geleverd, dus
// eerst wachten tot de General-tab er staat. `exact` is nodig en voldoende: de contentkop heeft
// ook een knop "About general settings", en er is precies één knop die exact "General" heet.
function settingsTab(page, name) {
  return page.getByRole('button', { name, exact: true });
}

async function openSettings(page) {
  await page.goto('/admin');
  await dismissOnboarding(page);
  await settingsTab(page, 'General').waitFor({ state: 'visible' });
}

async function signIn(page, email, password) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await dismissOnboarding(page);
}

// Geen inloggegevens nodig: deze probe hoort juist zonder sessie te falen.
test.describe('Zonder sessie', () => {
  test('kan /api/auth/set-password niet gebruiken om een account over te nemen', async ({ request }) => {
    // Bewust een niet-bestaand adres: zou de guard ooit terugvallen, dan wijzigt deze test geen
    // enkel echt account. De 403 (en niet 404) bewijst tegelijk dat de route geen geldige
    // e-mailadressen meer prijsgeeft.
    const res = await request.post('/api/auth/set-password', {
      data: { email: 'not-a-real-account-8f3a@example.invalid', password: 'Takeover-Probe-1' },
    });

    expect(res.status()).toBe(403);
  });
});

test.describe('Vendor komt niet bij andermans data', () => {
  test.skip(
    !VENDOR_EMAIL || !VENDOR_PASSWORD,
    'E2E_SUPPLIER_EMAIL / E2E_SUPPLIER_PASSWORD niet gezet — zie .env.example'
  );

  test('ziet in de board-data uitsluitend het eigen vendoraccount', async ({ page }) => {
    await signIn(page, VENDOR_EMAIL, VENDOR_PASSWORD);

    const res = await page.request.get('/api/data/purchase-orders');
    expect(res.status()).toBe(200);

    const rows = (await res.json()).rows || [];
    // Zonder orders bewijst deze test niets: "geen vreemde rijen" is dan een lege-staat-toeval.
    // Liever expliciet overslaan dan een groene test die geen afscherming aantoont.
    test.skip(
      rows.length === 0,
      'Testaccount heeft geen zichtbare orders op DEV — controleer vendor_account V000583 en de supplier-filterkolom'
    );

    const accounts = new Set(rows.map((row) => row.values?.vendorAccount));
    expect([...accounts]).toEqual(['V000583']);
  });

  test('krijgt 403 op de sublijnen van een order buiten de eigen scope', async ({ page }) => {
    await signIn(page, VENDOR_EMAIL, VENDOR_PASSWORD);

    const res = await page.request.get('/api/data/purchase-orders/rows/whsl/WSPO-0000000/details');
    expect(res.status()).toBe(403);
  });

  test.describe('afgeschermde API-paden', () => {
    const blocked = [
      '/api/data/vendors',
      '/api/data/items',
      '/api/data/purchase-orders/datamodel',
      '/api/admin/users',
      '/api/admin/settings/odata',
      '/api/admin/analytics/page-usage',
      '/api/data-links/datasets',
    ];

    for (const path of blocked) {
      test(`krijgt 403 op ${path}`, async ({ page }) => {
        await signIn(page, VENDOR_EMAIL, VENDOR_PASSWORD);

        expect((await page.request.get(path)).status()).toBe(403);
      });
    }
  });

  // /admin is voor een vendor bewust bereikbaar: de tab General bevat zijn persoonlijke
  // tabelzoom (SETTINGS_AUDIENCE.ALL). Wat niet mag, is dat daar een beheertab tussen staat.
  test('ziet op de instellingenpagina uitsluitend de eigen General-tab', async ({ page }) => {
    await signIn(page, VENDOR_EMAIL, VENDOR_PASSWORD);

    await openSettings(page);

    for (const tab of ['Users', 'Analytics', 'Mail template', 'OData', 'Data model', 'External links', 'Track changes', 'D365 refresh']) {
      await expect(settingsTab(page, tab)).toHaveCount(0);
    }
  });
});

test.describe('Employee komt niet bij admin-instellingen', () => {
  test.skip(
    !EMPLOYEE_EMAIL || !EMPLOYEE_PASSWORD,
    'E2E_TEST_EMAIL / E2E_TEST_PASSWORD niet gezet — zie .env.example'
  );

  test('krijgt 403 op instellingen zonder toegekende permissie', async ({ page }) => {
    await signIn(page, EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);

    expect((await page.request.get('/api/admin/settings/odata')).status()).toBe(403);
    expect((await page.request.get('/api/admin/settings/track-changes')).status()).toBe(403);
    expect((await page.request.get('/api/admin/d365-refresh/runs')).status()).toBe(403);
  });

  test('kan zichzelf niet tot admin promoveren en geen permissies uitdelen', async ({ page }) => {
    await signIn(page, EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);

    const me = await (await page.request.get('/api/auth/me')).json();

    const promote = await page.request.patch(`/api/admin/users/${NON_EXISTENT_USER_ID}`, {
      data: { role: 'admin' },
    });
    expect(promote.status()).toBe(403);

    const grant = await page.request.patch(`/api/admin/users/${me.user.id}/permissions`, {
      data: { permissions: [{ page_name: 'odata' }] },
    });
    expect(grant.status()).toBe(403);

    const remove = await page.request.delete(`/api/admin/users/${NON_EXISTENT_USER_ID}`);
    expect(remove.status()).toBe(403);

    const filterColumn = await page.request.put('/api/admin/supplier-filter-column', {
      data: { columnKey: 'vendorAccount' },
    });
    expect(filterColumn.status()).toBe(403);
  });

  test('ziet in de sidebar alleen de tabs waarvoor een permissie is toegekend', async ({ page }) => {
    await signIn(page, EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);

    const { permissions = [] } = await (await page.request.get('/api/auth/me')).json();

    await openSettings(page);

    for (const [tab, permission] of [['OData', 'odata'], ['Users', 'users'], ['Track changes', 'track-changes'], ['Analytics', 'analytics']]) {
      const tabButton = settingsTab(page, tab);
      if (permissions.includes(permission)) {
        await expect(tabButton).toBeVisible();
      } else {
        await expect(tabButton).toHaveCount(0);
      }
    }
  });
});
