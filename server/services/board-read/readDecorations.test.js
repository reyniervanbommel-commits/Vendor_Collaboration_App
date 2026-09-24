import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadTrackMarks, loadD365ChangeLedger } = require('./readDecorations');

describe('readDecorations', () => {
  it('slaat track-marks over zonder actieve kolommen', async () => {
    const result = await loadTrackMarks({}, 1, [], 'session', []);
    expect(result.trackMarksByCell.size).toBe(0);
  });

  it('geeft een leeg ledger terug zonder venster', async () => {
    const result = await loadD365ChangeLedger({ sinceMs: null });
    expect(result).toEqual({ d365LedgerRows: [], hasLedgerWindow: false });
  });
});
