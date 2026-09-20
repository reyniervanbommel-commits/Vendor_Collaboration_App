// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  PO_TABLE_ZOOM_DEFAULT,
  PO_TABLE_SPLIT_ZOOM_STYLE,
  applyPoTableZoom,
  clampPoTableZoom,
  formatPoTableZoomPercent,
  getPoTableZoom,
  parsePoTableZoom,
  poTableZoomedPx,
  resetPoTableZoomStoreForTests,
  setPoTableZoom,
  stepPoTableZoom,
  subscribePoTableZoom,
  visualPxToStored,
} from './poTableZoom';

afterEach(() => {
  resetPoTableZoomStoreForTests();
});

describe('parsePoTableZoom', () => {
  it('clamped finite numbers and rejects garbage', () => {
    expect(parsePoTableZoom(0.9)).toBe(0.9);
    expect(parsePoTableZoom('0.8')).toBe(0.8);
    expect(parsePoTableZoom('1);background:url(x)')).toBe(PO_TABLE_ZOOM_DEFAULT);
    expect(parsePoTableZoom(undefined)).toBe(PO_TABLE_ZOOM_DEFAULT);
    expect(clampPoTableZoom(0.5)).toBe(0.75);
    expect(clampPoTableZoom(2)).toBe(1.1);
  });
});

describe('step and format', () => {
  it('steps by 5% and formats percent', () => {
    expect(stepPoTableZoom(0.85, 1)).toBe(0.9);
    expect(stepPoTableZoom(0.75, -1)).toBe(0.75);
    expect(formatPoTableZoomPercent(0.85)).toBe('85%');
  });
});

describe('css helper', () => {
  it('builds calc from stored px', () => {
    expect(poTableZoomedPx(32)).toBe('calc(32px * var(--po-table-zoom, 0.85))');
    expect(visualPxToStored(170, 0.85)).toBe(200);
  });
});

describe('store', () => {
  it('never writes raw strings to CSS', () => {
    setPoTableZoom(0.9);
    expect(getPoTableZoom()).toBe(0.9);
    const el = document.createElement('div');
    applyPoTableZoom(el);
    expect(el.style.getPropertyValue('--po-table-zoom')).toBe('0.9');
    const unsafeEl = document.createElement('div');
    applyPoTableZoom(unsafeEl, '1);hack');
    expect(unsafeEl.style.getPropertyValue('--po-table-zoom')).toBe(String(PO_TABLE_ZOOM_DEFAULT));
    const seen = [];
    const unsub = subscribePoTableZoom((value) => seen.push(value));
    setPoTableZoom(0.95);
    expect(seen).toEqual([0.95]);
    unsub();
  });
});

describe('PO_TABLE_SPLIT_ZOOM_STYLE', () => {
  it('uses the CSS variable so Griffel is not required', () => {
    expect(PO_TABLE_SPLIT_ZOOM_STYLE.zoom).toBe('var(--po-table-zoom, 0.85)');
  });
});
