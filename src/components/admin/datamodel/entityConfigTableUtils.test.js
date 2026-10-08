import { describe, expect, it } from 'vitest';
import {
  columnMatchesFilter,
  customColumnDeleteMessage,
  linkedFromLineLabel,
  lookupSampleValue,
  mergeDiscoverySamples,
  mergeSampleByField,
  sortFlaggedFirst,
} from './entityConfigTableUtils';
import { BULK_TOGGLE_CONFIG as BULK_CONFIG } from './entityConfigTableUtils';

describe('entityConfigTableUtils samples', () => {
  it('vindt een sample case-insensitive op D365-veld of kolomkey', () => {
    expect(lookupSampleValue(
      { ItemNumber: 'ART-1' },
      'itemNumber',
      'ItemNumber',
    )).toBe('ART-1');
  });

  it('vult ontbrekende samples vanuit Discover zonder bestaande waarden te overschrijven', () => {
    const merged = mergeSampleByField(
      { ItemNumber: 'ART-1', SearchName: '—' },
      { SearchName: 'Boot', ProductGroupId: 'FG' },
    );
    expect(merged.ItemNumber).toBe('ART-1');
    expect(merged.SearchName).toBe('Boot');
    expect(merged.ProductGroupId).toBe('FG');
  });

  it('zet Discover-samples in de preview-tabellen', () => {
    const preview = mergeDiscoverySamples(
      {
        header: { sampleByField: { ItemNumber: '—' } },
        line: { sampleByField: {} },
      },
      { header: { ItemNumber: 'ART-2' }, line: {} },
    );
    expect(preview.header.sampleByField.ItemNumber).toBe('ART-2');
  });
});

describe('entityConfigTableUtils linked-from-line', () => {
  it('geeft een badge-label per koppelsoort', () => {
    expect(linkedFromLineLabel('total')).toBe('Linked line total');
    expect(linkedFromLineLabel('values')).toBe('Linked line values');
    expect(linkedFromLineLabel(null)).toBe('');
  });

  it('waarschuwt extra bij delete van een gekoppelde headerkolom', () => {
    const message = customColumnDeleteMessage({
      label: 'Remaining qty Total',
      linkedFromLine: 'total',
    });
    expect(message).toContain('Remaining qty Total');
    expect(message).toContain('Push total to header column');
    expect(message).toContain('all users');
  });

  it('vindt gekoppelde kolommen via de filter "linked"', () => {
    const column = { label: 'Qty Total', source: 'custom', linkedFromLine: 'total', dataType: 'number' };
    expect(columnMatchesFilter(column, 'linked', '—')).toBe(true);
    expect(columnMatchesFilter(column, 'custom column', '—')).toBe(true);
    expect(columnMatchesFilter({ ...column, linkedFromLine: undefined }, 'linked', '—')).toBe(false);
  });
});

describe('sortFlaggedFirst', () => {
  it('zet aangevinkte items bovenaan en houdt de rest in dezelfde volgorde', () => {
    const rows = [
      { name: 'A', on: false },
      { name: 'B', on: true },
      { name: 'C', on: false },
      { name: 'D', on: true },
    ];
    expect(sortFlaggedFirst(rows, (row) => row.on).map((row) => row.name)).toEqual(['B', 'D', 'A', 'C']);
  });
});

describe('mentionable bulk toggle', () => {
  it('is opgenomen met eligibility op mentionableAllowed', () => {
    const config = BULK_CONFIG.find((entry) => entry.key === 'mentionable');
    expect(config.label).toBe('Mentionable');
    expect(config.isEligible({ mentionableAllowed: true })).toBe(true);
    expect(config.isEnabled({ mentionable: true })).toBe(true);
  });
});
