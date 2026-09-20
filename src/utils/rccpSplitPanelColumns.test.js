import { describe, expect, it } from 'vitest';
import { resolveSplitPanelKpiColumns } from './rccpSplitPanelColumns';

describe('resolveSplitPanelKpiColumns', () => {
  it('returns 1 column, 0 rows when there are no tiles', () => {
    expect(resolveSplitPanelKpiColumns({ tileCount: 0, containerHeight: 500, tileHeight: 80 }))
      .toEqual({ columns: 1, rows: 0 });
  });

  it('falls back to 1 column when the height is not measured yet', () => {
    expect(resolveSplitPanelKpiColumns({ tileCount: 8, containerHeight: 0, tileHeight: 80 }))
      .toEqual({ columns: 1, rows: 8 });
  });

  it('keeps 1 column when all tiles fit the available height', () => {
    // 4 tiles * 80px + 3 gaps * 8px = 344px, fits in 400px.
    expect(resolveSplitPanelKpiColumns({
      tileCount: 4, containerHeight: 400, tileHeight: 80, gap: 8,
    })).toEqual({ columns: 1, rows: 4 });
  });

  it('switches to 2 balanced columns when 1 column no longer fits but 2 does', () => {
    // 6 tiles: 1 col needs 6*80+5*8=520px (too tall for 400px); 2 cols needs 3*80+2*8=256px (fits).
    expect(resolveSplitPanelKpiColumns({
      tileCount: 6, containerHeight: 400, tileHeight: 80, gap: 8,
    })).toEqual({ columns: 2, rows: 3 });
  });

  it('caps at 3 columns even when 2 columns still do not fit', () => {
    expect(resolveSplitPanelKpiColumns({
      tileCount: 10, containerHeight: 120, tileHeight: 80, gap: 8,
    })).toEqual({ columns: 3, rows: 4 });
  });

  it('never uses more columns than tiles', () => {
    expect(resolveSplitPanelKpiColumns({
      tileCount: 2, containerHeight: 10, tileHeight: 80, gap: 8,
    })).toEqual({ columns: 2, rows: 1 });
  });
});
