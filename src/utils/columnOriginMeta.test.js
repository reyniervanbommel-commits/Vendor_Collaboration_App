import { describe, expect, it } from 'vitest';
import {
  formatColumnClusterTooltip,
  formatColumnOriginTooltip,
  getColumnConnectionTooltip,
  getColumnOriginMeta,
} from './columnOriginMeta';

describe('getColumnOriginMeta', () => {
  it('zet formule-kolommen op Formula', () => {
    expect(getColumnOriginMeta({ source: 'custom', formulaExpr: 'qty * 2', label: 'Total' })).toEqual({
      key: 'formula',
      groupLabel: 'Formula',
      fieldLabel: '',
    });
  });

  it('zet custom kolommen op Custom', () => {
    expect(getColumnOriginMeta({ source: 'custom', label: 'Notes' })).toEqual({
      key: 'user',
      groupLabel: 'Custom',
      fieldLabel: '',
    });
  });

  it('zet header-D365 op Purchase orders met kolomnaam', () => {
    expect(getColumnOriginMeta({
      source: 'd365',
      level: 'header',
      label: 'Ordered qty',
      d365Field: 'PurchQty',
    })).toEqual({
      key: 'purchase-orders',
      groupLabel: 'Purchase orders',
      fieldLabel: 'Ordered qty',
    });
  });

  it('zet native line-kolommen op Lines', () => {
    expect(getColumnOriginMeta({
      source: 'd365',
      level: 'line',
      label: 'Qty',
    })).toEqual({
      key: 'lines',
      groupLabel: 'Lines',
      fieldLabel: 'Qty',
    });
  });

  it('groepeert vendor- en item-lookups per entiteit', () => {
    expect(getColumnOriginMeta({
      source: 'lookup',
      lookup: { targetTableKey: 'vendors', targetColumnLabel: 'Vendor name' },
    })).toEqual({
      key: 'vendors',
      groupLabel: 'Vendors',
      fieldLabel: 'Vendor name',
    });
    expect(getColumnOriginMeta({
      source: 'lookup',
      lookup: { targetTableKey: 'items', targetColumnLabel: 'Item number' },
    })).toEqual({
      key: 'items',
      groupLabel: 'Items',
      fieldLabel: 'Item number',
    });
  });

  it('zet ontvangstregel-lookups op Receipt lines', () => {
    expect(getColumnOriginMeta({
      source: 'lookup',
      label: 'Remaining qty (Ontvangstregels)',
      lookup: {
        targetTableKey: 'product-receipt-lines',
        targetTableLabel: 'Ontvangstregels',
        targetColumnLabel: 'Remaining qty',
      },
    })).toEqual({
      key: 'receipt-lines',
      groupLabel: 'Receipt lines',
      fieldLabel: 'Remaining qty',
    });
  });

  it('zet Excel-lookups op Excel met dataset en kolom', () => {
    expect(getColumnOriginMeta({
      source: 'lookup',
      lookup: {
        targetTableKey: 'upload-2',
        targetTableLabel: 'Planning.xlsx',
        targetColumnLabel: 'Week 12',
      },
    })).toEqual({
      key: 'excel',
      groupLabel: 'Excel',
      fieldLabel: 'Planning.xlsx · Week 12',
    });
  });
});

describe('formatColumnOriginTooltip', () => {
  it('combineert groep en veld', () => {
    expect(formatColumnOriginTooltip({
      groupLabel: 'Purchase orders',
      fieldLabel: 'Ordered qty',
    })).toBe('Purchase orders · Ordered qty');
  });

  it('laat groep staan zonder veld', () => {
    expect(formatColumnOriginTooltip({ groupLabel: 'Custom', fieldLabel: '' })).toBe('Custom');
  });
});

describe('formatColumnClusterTooltip', () => {
  it('houdt alleen de bron als er geen koppeling is', () => {
    expect(formatColumnClusterTooltip('Purchase orders · Amount', '')).toBe('Purchase orders · Amount');
  });

  it('zet bron en koppeling onder elkaar', () => {
    expect(formatColumnClusterTooltip(
      'Receipt lines · Remaining qty',
      'Connected to line column "Qty"'
    )).toBe('Receipt lines · Remaining qty\nConnected to line column "Qty"');
  });
});

describe('getColumnConnectionTooltip', () => {
  it('beschrijft één line-koppeling vanuit de header', () => {
    expect(getColumnConnectionTooltip(
      { level: 'header' },
      ['Subitem column "Qty" (values)']
    )).toBe('Connected to line column "Qty"');
  });

  it('beschrijft de date W/M-bronkolom', () => {
    expect(getColumnConnectionTooltip(
      { level: 'header' },
      ['Date column "Requested delivery date"']
    )).toBe('Connected to date column "Requested delivery date"');
  });

  it('beschrijft één header-koppeling vanuit de line', () => {
    expect(getColumnConnectionTooltip(
      { level: 'line' },
      ['Header column "Ordered qty" (values)']
    )).toBe('Connected to header column "Ordered qty"');
  });

  it('telt meerdere koppelingen', () => {
    expect(getColumnConnectionTooltip(
      { level: 'header' },
      ['Subitem column "Qty" (values)', 'Subitem column "Qty" (total)']
    )).toBe('Connected to 2 line columns');
  });

  it('is leeg zonder targets', () => {
    expect(getColumnConnectionTooltip({ level: 'header' }, [])).toBe('');
  });
});
