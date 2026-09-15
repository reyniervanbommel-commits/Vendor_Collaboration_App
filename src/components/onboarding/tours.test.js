import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { TOURS } from './tours';

const require = createRequire(import.meta.url);
const { ONBOARDING_TOUR_IDS } = require('../../../server/utils/onboardingSettings');

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// data-tour values built from a template literal in the component (prefix → template in source).
const DYNAMIC_ANCHORS = {
  'nav-': 'nav-${item.id}',
  'col-type-': 'col-type-${type.key}',
  'col-submenu-': 'col-submenu-${name}',
  'rccp-settings-tab-': 'rccp-settings-tab-${entry.value}',
};

function readAppSource(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).map((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'onboarding' ? '' : readAppSource(full);
    return /\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name) ? fs.readFileSync(full, 'utf8') : '';
  }).join('\n');
}

describe('tour definitions', () => {
  it('only uses tour ids the server accepts', () => {
    TOURS.forEach((tour) => expect(ONBOARDING_TOUR_IDS).toContain(tour.id));
  });

  it('has unique tour ids and unique step ids per tour', () => {
    expect(new Set(TOURS.map((tour) => tour.id)).size).toBe(TOURS.length);
    TOURS.forEach((tour) => {
      const ids = tour.steps.map((step) => step.id);
      expect(new Set(ids).size, tour.id).toBe(ids.length);
    });
  });

  it('points resumeTo at an earlier step of the same tour', () => {
    TOURS.forEach((tour) => {
      tour.steps.forEach((step, index) => {
        if (!step.resumeTo) return;
        const target = tour.steps.findIndex((s) => s.id === step.resumeTo);
        expect(target, `${tour.id}.${step.id}`).toBeGreaterThanOrEqual(0);
        expect(target, `${tour.id}.${step.id}`).toBeLessThan(index);
      });
    });
  });

  it('only references data-tour anchors that exist in the app', () => {
    const source = readAppSource(SRC_DIR);
    const selectors = TOURS.flatMap((tour) => tour.steps.flatMap((step) => [
      step.anchor, step.activate, step.advanceOn?.appears, step.advanceOn?.click,
    ]));
    const names = new Set(selectors.flatMap((selector) => (
      [...String(selector || '').matchAll(/\[data-tour="([^"]+)"\]/g)].map((match) => match[1])
    )));
    names.forEach((name) => {
      const exists = source.includes(`data-tour="${name}"`)
        || source.includes(`'${name}'`)
        || Object.entries(DYNAMIC_ANCHORS).some(([prefix, template]) => name.startsWith(prefix) && source.includes(template));
      expect(exists, name).toBe(true);
    });
  });

  it('gives every step copy, and every action step a way to advance', () => {
    TOURS.forEach((tour) => {
      expect(tour.version).toBeGreaterThanOrEqual(1);
      tour.steps.forEach((step) => {
        expect(step.title, `${tour.id}.${step.id}`).toBeTruthy();
        expect(step.body || step.bullets, `${tour.id}.${step.id}`).toBeTruthy();
        if (step.action) expect(step.advanceOn, `${tour.id}.${step.id}`).toBeTruthy();
      });
    });
  });
});
