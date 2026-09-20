// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyPoTableSessionOverlay,
  clearAllPoTableSessions,
  clearPoTableSession,
  poTableSessionStorageKey,
  readLastPoTableSession,
  readPoTableSession,
  savePoTableSession,
} from './poTableSessionState';

const SNAPSHOT = {
  filterByColumn: { status: { operator: 'equals', value: 'Open', secondaryValue: '' } },
  sortState: { columnKey: 'vendor', direction: 'asc' },
  grouping: { columnKey: 'status' },
};

describe('poTableSessionState', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('saves and reads a table snapshot per view id', () => {
    savePoTableSession(7, SNAPSHOT);
    expect(readPoTableSession(7)).toEqual(SNAPSHOT);
    expect(readPoTableSession(8)).toBeNull();
  });

  it('keeps a last-snapshot so the table can hydrate before the first paint', () => {
    savePoTableSession(7, SNAPSHOT);
    expect(readLastPoTableSession()).toEqual(SNAPSHOT);
  });

  it('uses a dedicated all-orders key when view id is missing', () => {
    savePoTableSession(null, SNAPSHOT);
    expect(poTableSessionStorageKey(null)).toBe('po:tableSession:purchase-orders:all-orders');
    expect(readPoTableSession(null)).toEqual(SNAPSHOT);
    expect(readPoTableSession(7)).toBeNull();
  });

  it('returns null when nothing was saved or JSON is corrupt', () => {
    expect(readPoTableSession(7)).toBeNull();
    window.sessionStorage.setItem(poTableSessionStorageKey(7), '{not-json');
    expect(readPoTableSession(7)).toBeNull();
  });

  it('applies the overlay only when a snapshot exists', () => {
    const apply = [];
    expect(applyPoTableSessionOverlay(7, (state) => apply.push(state))).toBe(false);
    expect(apply).toEqual([]);

    savePoTableSession(7, SNAPSHOT);
    expect(applyPoTableSessionOverlay(7, (state) => apply.push(state))).toBe(true);
    expect(apply).toEqual([SNAPSHOT]);
  });

  it('clears one view without dropping the others', () => {
    savePoTableSession(7, SNAPSHOT);
    savePoTableSession(null, SNAPSHOT);
    clearPoTableSession(7);
    expect(readPoTableSession(7)).toBeNull();
    expect(readPoTableSession(null)).toEqual(SNAPSHOT);
  });

  it('clears every PO table session key', () => {
    savePoTableSession(7, SNAPSHOT);
    savePoTableSession(null, SNAPSHOT);
    window.sessionStorage.setItem('unrelated', 'keep');
    clearAllPoTableSessions();
    expect(readPoTableSession(7)).toBeNull();
    expect(readPoTableSession(null)).toBeNull();
    expect(window.sessionStorage.getItem('unrelated')).toBe('keep');
  });
});
