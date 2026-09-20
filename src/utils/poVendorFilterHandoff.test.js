// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  readPoFilterByColumnForRccp,
  readPoRccpHandoff,
  savePoFilterByColumnForRccp,
  savePoRccpHandoff,
} from './poVendorFilterHandoff';

describe('poVendorFilterHandoff', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('saves and reads back the active PO filter', () => {
    const filterByColumn = { vendorAccount: { operator: 'equals', value: 'V000696' } };
    savePoFilterByColumnForRccp(filterByColumn);
    expect(readPoFilterByColumnForRccp()).toEqual(filterByColumn);
  });

  it('saves and reads back a v1 RCCP handoff payload', () => {
    const filterByColumn = { vendorAccount: { operator: 'equals', value: 'V000696' } };
    savePoRccpHandoff({ filterByColumn, derivedVendor: 'V000696' });
    expect(readPoRccpHandoff()).toEqual({ filterByColumn, derivedVendor: 'V000696' });
  });

  it('unwraps v1 payloads when reading the legacy filter-only contract', () => {
    const filterByColumn = { vendorAccount: { operator: 'equals', value: 'V000696' } };
    savePoRccpHandoff({ filterByColumn, derivedVendor: 'V000696' });
    expect(readPoFilterByColumnForRccp()).toEqual(filterByColumn);
  });

  it('reads legacy filter objects without a v key as filter-only payloads', () => {
    const filterByColumn = { vendorAccount: { operator: 'equals', value: 'V000696' } };
    window.sessionStorage.setItem('po:activeFilterByColumn', JSON.stringify(filterByColumn));
    expect(readPoRccpHandoff()).toEqual({ filterByColumn, derivedVendor: '' });
    expect(readPoFilterByColumnForRccp()).toEqual(filterByColumn);
  });

  it('returns null when nothing was saved yet', () => {
    expect(readPoFilterByColumnForRccp()).toBeNull();
  });

  it('clears the stored filter when an empty filter is saved', () => {
    savePoFilterByColumnForRccp({ vendorAccount: { operator: 'equals', value: 'V000696' } });
    savePoFilterByColumnForRccp({});
    expect(readPoFilterByColumnForRccp()).toBeNull();
  });

  it('clears the stored handoff when filter and derived vendor are empty', () => {
    savePoRccpHandoff({ filterByColumn: { vendorAccount: { operator: 'equals', value: 'V000696' } }, derivedVendor: 'V000696' });
    savePoRccpHandoff({ filterByColumn: {}, derivedVendor: '' });
    expect(readPoRccpHandoff()).toBeNull();
  });

  it('ignores corrupted JSON in storage', () => {
    window.sessionStorage.setItem('po:activeFilterByColumn', '{not-json');
    expect(readPoFilterByColumnForRccp()).toBeNull();
    expect(readPoRccpHandoff()).toBeNull();
  });

  it('ignores v1 payloads with a non-string derived vendor', () => {
    window.sessionStorage.setItem('po:activeFilterByColumn', JSON.stringify({ v: 1, filterByColumn: {}, derivedVendor: 1 }));
    expect(readPoRccpHandoff()).toBeNull();
  });
});
