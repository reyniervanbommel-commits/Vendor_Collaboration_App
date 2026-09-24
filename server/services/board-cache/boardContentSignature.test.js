'use strict';

const { contentSignature } = require('./boardContentSignature');

describe('contentSignature', () => {
  const base = {
    syncedAt: 's',
    maxContentChangedAt: 'c',
    maxFirstSeenAt: 'f',
    maxCustomValueAt: 'v',
    maxLedgerAt: 'l',
    maxColumnsAt: 'col',
    exclusionCount: 1,
    maxExclusionAt: 'e',
    settingsAt: 'set',
  };

  it('neemt inhoudsbepalende revisiondelen mee, niet userViewedAt of userBoardSettingsAt', () => {
    const left = contentSignature({ ...base, userViewedAt: 'a', userBoardSettingsAt: 'x' });
    const right = contentSignature({ ...base, userViewedAt: 'b', userBoardSettingsAt: 'y' });
    expect(left).toBe(right);
    expect(left).not.toContain('userId');
  });

  it.each([
    ['syncedAt', 'refresh'],
    ['maxCustomValueAt', 'custom-value'],
    ['maxColumnsAt', 'column-schema'],
    ['maxLedgerAt', 'ledger'],
    ['settingsAt', 'sync-filters'],
    ['maxExclusionAt', 'row-exclusion'],
    ['exclusionCount', 9],
  ])('verandert wanneer %s wijzigt, dus die mutatie geen extra invalidate nodig heeft', (field, next) => {
    expect(contentSignature(base)).not.toBe(contentSignature({ ...base, [field]: next }));
  });
});
