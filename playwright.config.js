'use strict';

// Playwright Test-config voor de e2e/-suite (los van playwright/, dat bevat alleen ad-hoc
// perf-scripts die los draaien via `node`, geen testrunner). Zelfde TEST_BASE_URL-conventie als
// die perf-scripts al gebruiken, zodat dezelfde env var werkt voor beide.
//
// dotenv laden zoals de rest van de app (server/server.js) — Playwright Test laadt .env niet
// automatisch, zonder dit zouden E2E_TEST_EMAIL/PASSWORD altijd leeg zijn buiten CI.
require('dotenv').config();

const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = (process.env.TEST_BASE_URL || 'http://localhost:5178').replace(/\/$/, '');
const isCI = Boolean(process.env.CI);

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  // Ook lokaal retries: de preview- en DEV-omgeving zijn Container Apps met min-replicas 0. Na een
  // koude start of tijdens opschalen lopen losse requests op een timeout of ECONNRESET, zonder dat
  // er iets mis is met de app. Zonder retry faalt elke run op een andere willekeurige test.
  retries: 2,
  // DEV is één bescheiden Container App-instance, geen lokale server — meerdere workers die
  // tegelijk inloggen + board-data ophalen veroorzaken onderling resource-contentie (waargenomen:
  // API-calls die individueel 5-10s+ duurden). Serieel draaien is trager maar betrouwbaar.
  workers: 1,
  // Default (30s) is te krap tegen een DEV Container App na een koude start (TTFB kan tientallen
  // seconden zijn bij de eerste hit na een deploy) — zelfde soort marge als de Vitest-testTimeout-fix.
  timeout: 90000,
  // Losse UI-assertions (expect(locator).toBeVisible()) hebben een EIGEN, kortere default-timeout
  // (5s) los van de test-timeout hierboven — te krap gebleken tegen board-data die op DEV soms
  // 5-10s per API-call kost.
  expect: { timeout: 15000 },
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
