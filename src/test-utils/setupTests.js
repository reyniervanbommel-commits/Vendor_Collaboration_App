import '@testing-library/jest-dom/vitest';

// jsdom kent geen ResizeObserver; Fluent-componenten die zich aan hun container aanpassen
// (o.a. MessageBar's reflow) crashen daar hard op. Minimale no-op zodat die componenten in
// tests renderen — layout-gedrag meten we niet in jsdom, dat gaat via Playwright.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
