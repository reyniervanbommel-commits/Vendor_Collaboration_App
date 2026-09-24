import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { historyCellKey, buildHistoryByCell, applyRecordFilter } = require('./historyCells');

describe('historyCells', () => {
  it('groepeert historie per cel', () => {
    const key = historyCellKey('whsl', 'PO-1', 2);
    const map = buildHistoryByCell([
      { partition_key: 'whsl', record_key: 'PO-1', detail_key: 2, column_id: 9 },
    ]);
    expect(map.get(key)).toEqual({ 9: true });
    expect(buildHistoryByCell(null).size).toBe(0);
  });

  it('zet een recordfilter op het request', () => {
    const inputs = {};
    const request = { input(name, _type, value) { inputs[name] = value; return this; } };
    const clause = applyRecordFilter(request, { partitionKey: 'whsl', recordKey: 'PO-1' }, 'c');
    expect(clause).toBe('AND c.partition_key = @partitionKey AND c.record_key = @recordKey');
    expect(inputs).toEqual({ partitionKey: 'whsl', recordKey: 'PO-1' });
    expect(applyRecordFilter(request, null)).toBe('');
  });
});
