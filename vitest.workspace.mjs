import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Twee projecten zodat jsdom alleen draait waar een DOM nodig is. Het opzetten van een jsdom-
// omgeving plus de jest-dom-matchers kost per testbestand ~25s, en die prijs betaalden ook de
// puur rekenkundige tests in server/ en src/utils/ (samen ~40% van de suite). Coverage en de
// thresholds blijven in vitest.config.mjs — die gelden workspace-breed.
//
// Heeft een los bestand in het node-project tóch DOM-globals nodig? Zet dan bovenaan dat
// testbestand `// @vitest-environment jsdom`; die docblock gaat voor de projectinstelling.

const EXCLUDE = [
  '**/node_modules/**',
  '**/.worktrees/**',
  '**/.claude/worktrees/**',
  // Playwright Test-suite (e2e/*.spec.js) — aparte runner (`npm run test:e2e`).
  '**/e2e/**',
];

export default defineWorkspace([
  {
    test: {
      name: 'node',
      environment: 'node',
      globals: true,
      testTimeout: 15000,
      include: [
        'server/**/*.test.{js,jsx}',
        'scripts/**/*.test.{js,mjs}',
        'src/utils/**/*.test.js',
      ],
      exclude: EXCLUDE,
    },
  },
  {
    plugins: [react()],
    test: {
      name: 'dom',
      environment: 'jsdom',
      globals: true,
      // Ruimere marge: DOM-zware tests (findByRole/waitFor) liepen onder coverage-instrumentatie
      // willekeurig over de default 5s — puur CPU-overhead, geen logica.
      testTimeout: 15000,
      setupFiles: ['./src/test-utils/setupTests.js'],
      include: ['src/**/*.test.{js,jsx}'],
      exclude: [...EXCLUDE, 'src/utils/**/*.test.js'],
    },
  },
]);
