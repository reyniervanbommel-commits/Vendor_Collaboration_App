import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Backend-tests hebben geen DOM nodig; een jsdom-omgeving per testbestand is puur overhead.
    // Gemeten op server/utils (283 tests): 894s met jsdom tegen 323s met node.
    environmentMatchGlobs: [
      ['server/**', 'node'],
      ['scripts/**', 'node'],
    ],
    globals: true,
    setupFiles: ['./src/test-utils/setupTests.js'],
    // V8-coverage-instrumentatie maakt de suite ~4x trager; zonder marge liep dat een enkele
    // DOM-zware test (findByRole/waitFor) willekeurig over de default 5s-timeout — niet
    // reproduceerbaar op logica, puur CPU-overhead. Ruimere marge voorkomt die flakiness.
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // Ratchet, geen streefcijfer: voorkomt dat de TOTALE dekking terugzakt t.o.v. de gemeten
      // baseline (2026-08-10: lines/statements 35.96%, functions 58.66%, branches 68.63%),
      // met een paar procentpunt marge. Complementair aan de Kwaliteitspoort-regel (die per
      // nieuw kernbestand een test verwacht) — dit bewaakt het totaal, niet losse bestanden.
      // Ophogen zodra de dekking structureel stijgt, zie CLAUDE.md → Kwaliteitspoort.
      thresholds: {
        lines: 33,
        statements: 33,
        functions: 55,
        branches: 65,
      },
    },
    exclude: [
      '**/node_modules/**',
      '**/.worktrees/**',
      '**/.claude/worktrees/**',
      // Playwright Test-suite (e2e/*.spec.js) — aparte runner (`npm run test:e2e`), Vitest's
      // default include-patroon matcht anders ook *.spec.js en crasht op test.describe().
      '**/e2e/**',
    ],
  },
});
