import { describe, expect, it } from 'vitest';
import { buildPoHeaderHoverModel, getPoHeaderConnectionTargets } from './poHeaderHoverModel';

const vendorColumn = { key: 'vendor', label: 'Vendor account', dataType: 'text', source: 'd365' };

describe('buildPoHeaderHoverModel', () => {
  it('returns null without a column', () => {
    expect(buildPoHeaderHoverModel({})).toBe(null);
  });

  it('returns null when the column has no active filter', () => {
    expect(buildPoHeaderHoverModel({ column: vendorColumn })).toBe(null);
    expect(buildPoHeaderHoverModel({
      column: vendorColumn,
      filter: { operator: 'oneOf', value: [] },
    })).toBe(null);
  });

  it('returns only the active filter summary', () => {
    expect(buildPoHeaderHoverModel({
      column: vendorColumn,
      filter: { operator: 'contains', value: 'Acme' },
    })).toEqual({ text: 'contains: Acme' });
  });

  it('summarizes oneOf and between filters', () => {
    expect(buildPoHeaderHoverModel({
      column: vendorColumn,
      filter: { operator: 'oneOf', value: ['Acme', 'Beta'] },
    }).text).toBe('is one of: Acme, Beta');

    expect(buildPoHeaderHoverModel({
      column: { key: 'qty', label: 'Qty', dataType: 'number' },
      filter: { operator: 'between', value: '10', secondaryValue: '20' },
    }).text).toBe('is between: 10 and 20');
  });

    it('summarizes color filters without scanning rows', () => {
    expect(buildPoHeaderHoverModel({
      column: { key: 'status', label: 'Status', dataType: 'status' },
      filter: { operator: 'colorIs', colors: ['#c02f64', '#6161ff'] },
    }).text).toBe('color is: 2 colors');
  });
});

describe('getPoHeaderConnectionTargets', () => {
  it('koppelt een Date W/M-kolom aan de bron-datumkolom', () => {
    expect(getPoHeaderConnectionTargets({
      columnKey: 'deliveryWeek',
      column: {
        key: 'deliveryWeek',
        dataType: 'date_period',
        options: { sourceColumnKey: 'requestedDeliveryDate' },
      },
      columns: [
        { key: 'requestedDeliveryDate', label: 'Requested delivery date' },
        { key: 'deliveryWeek', label: 'Date W/M' },
      ],
    })).toEqual(['Date column "Requested delivery date"']);
  });

  it('laat gewone kolommen zonder koppeling', () => {
    expect(getPoHeaderConnectionTargets({
      columnKey: 'vendor',
      column: { key: 'vendor', dataType: 'text' },
      columns: [{ key: 'vendor', label: 'Vendor' }],
    })).toEqual([]);
  });
});
