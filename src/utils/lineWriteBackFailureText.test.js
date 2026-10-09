import { describe, expect, it } from 'vitest';
import { formatCorrectAllFailure, formatLineFailures } from './lineWriteBackFailureText';

const blocked = { detailKey: 20, message: "Item 'L-10780-02' is blocked for 'Purchase order'." };

describe('formatLineFailures', () => {
  it('toont één regel met nummer en reden', () => {
    expect(formatLineFailures([blocked])).toBe("Line 20: Item 'L-10780-02' is blocked for 'Purchase order'.");
  });

  it('zet een punt achter een reden zonder leesteken', () => {
    expect(formatLineFailures([{ detailKey: 1, message: 'PurchaseOrderName is locked' }]))
      .toBe('Line 1: PurchaseOrderName is locked.');
  });

  it('toont maximaal 3 regels plus "+N more"', () => {
    const failures = [1, 2, 3, 4, 5].map((n) => ({ detailKey: n, message: 'Blocked.' }));
    expect(formatLineFailures(failures))
      .toBe('Line 1: Blocked. Line 2: Blocked. Line 3: Blocked. (+2 more)');
  });

  it('geeft een lege string zonder failures', () => {
    expect(formatLineFailures([])).toBe('');
    expect(formatLineFailures(undefined)).toBe('');
  });
});

describe('formatCorrectAllFailure', () => {
  it('partial: aantal bijgewerkt plus regelreden', () => {
    expect(formatCorrectAllFailure({ updated: 1, attempted: 2, failed: 1, failures: [blocked] }))
      .toBe("1 of 2 lines updated. Line 20: Item 'L-10780-02' is blocked for 'Purchase order'.");
  });

  it('alles mislukt: alleen de regelredenen', () => {
    expect(formatCorrectAllFailure({ updated: 0, attempted: 1, failed: 1, failures: [blocked] }))
      .toBe("Line 20: Item 'L-10780-02' is blocked for 'Purchase order'.");
  });

  it('zonder failure-detail: generieke telling', () => {
    expect(formatCorrectAllFailure({ updated: 0, attempted: 2, failed: 2, failures: [] }))
      .toBe('Write-back failed on 2 of 2 lines.');
  });
});
