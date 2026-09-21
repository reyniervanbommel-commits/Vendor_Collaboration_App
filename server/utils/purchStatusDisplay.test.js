'use strict';

const {
  formatPurchStatusDisplay,
  isPurchStatusAliasText,
  purchStatusValuesEquivalent,
  resolvePurchStatusRefValue,
} = require('./purchStatusDisplay');

describe('purchStatusDisplay (server)', () => {
  it('toont Backorder als Open order', () => {
    expect(formatPurchStatusDisplay('Backorder')).toBe('Open order');
    expect(isPurchStatusAliasText('Open order')).toBe(true);
    expect(purchStatusValuesEquivalent('Backorder', 'Open order')).toBe(true);
  });

  it('mapt statuskolom-referenties naar het schermlabel', () => {
    expect(resolvePurchStatusRefValue('status', 'Backorder')).toBe('Open order');
    expect(resolvePurchStatusRefValue('vendor', 'Backorder')).toBe('Backorder');
  });
});
