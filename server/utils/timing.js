'use strict';

// Request-scoped Server-Timing.
//
// Doel: élk stuk backend-code dat we later toevoegen kan zijn duur bijdragen aan de
// Server-Timing-header ZONDER `req` door de call-stack te hoeven doorgeven. Dat gaat via
// AsyncLocalStorage: de middleware in server.js draait elke request in een verse timing-context;
// `time(label, fn)` meet een benoemd blok (waar dan ook, ook diep in een service) en het
// verschijnt als aparte metric in DevTools → Network → Timing.
//
// Gebruik:
//   const { time } = require('../utils/timing');
//   const rows = await time('db_read', () => pool.request().query(sql));
//
// Buiten een request (bijv. de achtergrond-scheduler) is er geen context; dan is time() een
// no-op-wrapper die alleen fn() uitvoert. Veilig overal te gebruiken.

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

// Draai de verwerking van één request in een verse timing-context.
function runWithRequestTiming(fn) {
  return storage.run({ timings: [] }, fn);
}

// Meet een benoemd (a)sync blok en registreer de duur op de huidige request (indien aanwezig).
async function time(label, fn) {
  const start = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    const durMs = Number(process.hrtime.bigint() - start) / 1e6;
    const store = storage.getStore();
    if (store && Array.isArray(store.timings)) {
      store.timings.push({ label, dur: durMs });
    }
  }
}

// Registreer een benoemd feit zonder er een blok voor te meten. Bedoeld voor een keuze die je in
// de header terug wilt zien — welke tak van een leesplan draaide, welke cache raak was — waar de
// duur nul is en alleen de naam informatie draagt. Zelfde no-op-gedrag buiten een request.
function mark(label, durMs = 0) {
  const store = storage.getStore();
  if (store && Array.isArray(store.timings)) {
    store.timings.push({ label, dur: durMs });
  }
}

// Bouw de Server-Timing-header: altijd `app` (totaal) + alle benoemde metingen van deze request.
// Labels worden gesaneerd tot een geldig Server-Timing-token.
function buildServerTimingHeader(totalMs) {
  const parts = [`app;dur=${totalMs.toFixed(1)}`];
  const store = storage.getStore();
  if (store && Array.isArray(store.timings)) {
    for (const t of store.timings) {
      const name = String(t.label).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40) || 'x';
      parts.push(`${name};dur=${t.dur.toFixed(1)}`);
    }
  }
  return parts.join(', ');
}

module.exports = { runWithRequestTiming, time, mark, buildServerTimingHeader };
