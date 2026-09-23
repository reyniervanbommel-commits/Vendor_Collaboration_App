import { defineConfig } from 'vitest/config';

// Omgeving, includes en setup staan per project in vitest.workspace.mjs (node vs jsdom) — dat
// vervangt de eerdere environmentMatchGlobs-aanpak en houdt óók de jest-dom-setup weg bij tests
// die geen DOM nodig hebben. Gemeten op server/utils (283 tests): 894s met jsdom tegen 323s met
// node. Hier blijft alleen wat workspace-breed geldt: coverage en de thresholds.
export default defineConfig({
  test: {
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
  },
});
