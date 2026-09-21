import { describe, expect, it } from 'vitest';
import {
  formatColumnUniqueValue,
  formatPurchStatusDisplay,
  isPurchaseOrderStatusColumn,
  isPurchStatusAliasText,
  purchStatusValuesEquivalent,
  serializePurchStatusFilterValue,
  toPurchStatusStoredValue,
} from './purchStatusDisplay';

describe('purchStatusDisplay', () => {
  it('herkent de D365 purchase-order statuskolom', () => {
    expect(isPurchaseOrderStatusColumn({ d365Field: 'PurchaseOrderStatus' })).toBe(true);
    expect(isPurchaseOrderStatusColumn({ key: 'status' })).toBe(true);
    expect(isPurchaseOrderStatusColumn({ columnKey: 'purchaseOrderStatus' })).toBe(true);
    expect(isPurchaseOrderStatusColumn({ key: 'vendorAccount' })).toBe(false);
  });

  it('toont Backorder als Open order, andere waarden ongewijzigd', () => {
    expect(formatPurchStatusDisplay('Backorder')).toBe('Open order');
    expect(formatPurchStatusDisplay('backorder')).toBe('Open order');
    expect(formatPurchStatusDisplay('Invoiced')).toBe('Invoiced');
    expect(formatPurchStatusDisplay('Canceled')).toBe('Canceled');
    expect(formatPurchStatusDisplay('')).toBe('');
  });

  it('zet het D365-schermlabel terug naar de opgeslagen enum-waarde', () => {
    expect(toPurchStatusStoredValue('Open order')).toBe('Backorder');
    expect(toPurchStatusStoredValue('Backorder')).toBe('Backorder');
    expect(toPurchStatusStoredValue('Invoiced')).toBe('Invoiced');
  });

  it('formatteert unieke filterwaarden alleen voor de statuskolom', () => {
    expect(formatColumnUniqueValue({ d365Field: 'PurchaseOrderStatus' }, 'Backorder')).toBe('Open order');
    expect(formatColumnUniqueValue({ key: 'vendor' }, 'Backorder')).toBe('Backorder');
  });

  it('herkent Backorder en Open order als dezelfde status', () => {
    expect(isPurchStatusAliasText('Backorder')).toBe(true);
    expect(isPurchStatusAliasText('Open order')).toBe(true);
    expect(isPurchStatusAliasText('Invoiced')).toBe(false);
    expect(purchStatusValuesEquivalent('Backorder', 'Open order')).toBe(true);
    expect(purchStatusValuesEquivalent('open order', 'backorder')).toBe(true);
    expect(purchStatusValuesEquivalent('Invoiced', 'Open order')).toBe(false);
    expect(purchStatusValuesEquivalent('Acme', 'Acme')).toBe(true);
  });

  it('zet getypte Open order-filterwaarden terug naar de opgeslagen enum', () => {
    const statusColumn = { key: 'status', d365Field: 'PurchaseOrderStatus' };
    expect(serializePurchStatusFilterValue(statusColumn, 'Open order')).toBe('Backorder');
    expect(serializePurchStatusFilterValue(statusColumn, ['Open order', 'Invoiced'])).toEqual(['Backorder', 'Invoiced']);
    expect(serializePurchStatusFilterValue({ key: 'vendor' }, 'Open order')).toBe('Open order');
  });
});
