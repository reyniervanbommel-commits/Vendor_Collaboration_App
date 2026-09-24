import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildDetailRollup, buildItemFilterKey, resolveLightDetailColumns } = require('./buildDetailRow');

describe('buildDetailRow helpers', () => {
  it('rolt alleen ongeziene verwijderingen en unieke artikelen op', () => {
    const rollup = buildDetailRollup([
      { values: { itemNumber: 'A' }, isNew: true, isRemoved: false, hasRemovalChange: false, changedFieldKeys: [] },
      { values: { itemNumber: 'A' }, isRemoved: true, hasRemovalChange: true, changedFieldKeys: [] },
    ]);
    expect(rollup.detailCount).toBe(2);
    expect(rollup.hasNewLine).toBe(true);
    expect(rollup.hasRemovedLine).toBe(true);
    expect(rollup.productImageSummary).toEqual({ firstItemNumber: 'A', additionalItemCount: 0 });
  });

  it('bouwt een itemfilter-sleutel en weigert een formulekolom op het lichte pad', () => {
    expect(buildItemFilterKey('Whsl', ' ART-1 ')).toBe('whsl|ART-1');
    expect(resolveLightDetailColumns({
      detailCols: [{ key: 'itemNumber', source: 'custom', formulaExpr: '1+1' }],
    })).toBeNull();
  });
});
