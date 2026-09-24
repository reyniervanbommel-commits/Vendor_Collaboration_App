import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { indexCustomValuesByCell } = require('./readCacheRows');

describe('indexCustomValuesByCell', () => {
  it('zet custom waarden per cel op het kolomtype', () => {
    const map = indexCustomValuesByCell([
      { partition_key: 'a', record_key: 'b', detail_key: -1, key: 'qty', data_type: 'number', value_number: '4', value_text: null, value_date: null, value_bool: null },
      { partition_key: 'a', record_key: 'b', detail_key: -1, key: 'flag', data_type: 'boolean', value_number: null, value_text: null, value_date: null, value_bool: true },
    ]);
    expect(map.get('a|b|-1')).toEqual({ qty: 4, flag: true });
  });
});
