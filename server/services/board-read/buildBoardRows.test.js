import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { assembleBoardRows } = require('./buildBoardRows');

describe('assembleBoardRows', () => {
  it('geeft een lege rijenset terug zonder masters', () => {
    const result = assembleBoardRows({
      masterRows: [],
      detailsByRecord: new Map(),
      orderChanges: new Map(),
      lineChangesByOrder: new Map(),
      customByCell: new Map(),
      historyByCell: new Map(),
      trackMarks: { trackMarksByCell: new Map() },
      buildStats: { detailMs: 0, lookupMs: 0, pavMs: 0, formulaMs: 0, detailRows: 0 },
      rollupByRecord: null,
      itemsLineFilterActive: false,
      MASTER_DETAIL_KEY: -1,
    });
    expect(result.rows).toEqual([]);
    expect(result.newCount).toBe(0);
  });
});
