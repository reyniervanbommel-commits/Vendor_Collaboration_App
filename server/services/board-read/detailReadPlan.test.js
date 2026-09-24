import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { fieldsProjectionEnabled, parseDefaultFilterRules } = require('./detailReadPlan');

describe('detailReadPlan', () => {
  afterEach(() => {
    delete process.env.PO_DETAIL_FIELDS_PROJECTION;
  });

  it('zet de fields-projectie alleen aan met een expliciete schakelaar', () => {
    expect(fieldsProjectionEnabled()).toBe(false);
    process.env.PO_DETAIL_FIELDS_PROJECTION = 'true';
    expect(fieldsProjectionEnabled()).toBe(true);
  });

  it('leest filterregels uit json', () => {
    expect(parseDefaultFilterRules('[{"field":"a"}]')).toEqual([{ field: 'a' }]);
    expect(parseDefaultFilterRules('geen-json')).toEqual([]);
  });
});
