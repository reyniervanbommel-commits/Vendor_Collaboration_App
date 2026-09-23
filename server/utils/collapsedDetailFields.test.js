'use strict';

const {
  resolveCollapsedDetailFields,
  buildDetailJsonFromProjection,
  buildDetailProjectionSql,
  collectLinkedLineColumnKeys,
} = require('./collapsedDetailFields');

const ITEM_COLUMN = { key: 'itemNumber', source: 'source', sourceField: 'ItemNumber', dataType: 'string' };
const QTY_COLUMN = { key: 'quantity', source: 'source', sourceField: 'PurchaseQuantity', dataType: 'number' };

describe('resolveCollapsedDetailFields', () => {
  it('houdt alleen itemNumber over als er geen koppelingen zijn', () => {
    const fields = resolveCollapsedDetailFields({ detailColumns: [ITEM_COLUMN, QTY_COLUMN] });

    expect(fields).toEqual([{ field: 'ItemNumber', type: 'string', fallback: 'itemNumber' }]);
  });

  it('voegt de bronvelden van gekoppelde lijnkolommen toe', () => {
    const fields = resolveCollapsedDetailFields({
      detailColumns: [ITEM_COLUMN, QTY_COLUMN],
      runtimeLinks: {
        lineTotalHeaderLinks: [{ lineColumnKey: 'quantity', headerColumnKey: 'qty_total' }],
      },
    });

    expect(fields).toEqual([
      { field: 'ItemNumber', type: 'string', fallback: 'itemNumber' },
      { field: 'PurchaseQuantity', type: 'number', fallback: 'quantity' },
    ]);
  });

  it('vertaalt een lookup-kolom naar het bronveld waarmee de lookup zoekt', () => {
    const fields = resolveCollapsedDetailFields({
      detailColumns: [ITEM_COLUMN],
      runtimeLinks: {
        lineValueHeaderLinks: [{ lineColumnKey: 'items_searchName', headerColumnKey: 'item_values' }],
      },
      lookups: [{
        sourceScope: 'detail',
        sourceFieldKey: 'itemNumber',
        fieldEntries: [['items_searchName', 'searchName']],
      }],
    });

    expect(fields).toContainEqual({ field: 'itemNumber', type: 'string' });
  });

  it('volgt de referenties van een formulekolom', () => {
    const fields = resolveCollapsedDetailFields({
      detailColumns: [ITEM_COLUMN, QTY_COLUMN, { key: 'openQty', source: 'custom', formulaExpr: '[quantity] - 1' }],
      runtimeLinks: {
        lineTotalHeaderLinks: [{ lineColumnKey: 'openQty', headerColumnKey: 'open_total' }],
      },
      formulaReferences: new Map([['openqty', ['quantity']]]),
    });

    expect(fields).toContainEqual({ field: 'PurchaseQuantity', type: 'number', fallback: 'quantity' });
  });

  it('valt terug op de volledige blob bij een formule zonder bekende referenties', () => {
    const fields = resolveCollapsedDetailFields({
      detailColumns: [ITEM_COLUMN, { key: 'openQty', source: 'custom', formulaExpr: '[quantity] - 1' }],
      runtimeLinks: {
        lineTotalHeaderLinks: [{ lineColumnKey: 'openQty', headerColumnKey: 'open_total' }],
      },
    });

    expect(fields).toBeNull();
  });

  it('valt terug op de volledige blob bij een veldnaam die niet in een JSON-pad past', () => {
    const fields = resolveCollapsedDetailFields({
      detailColumns: [{ key: 'itemNumber', source: 'source', sourceField: "Item'Number" }],
    });

    expect(fields).toBeNull();
  });

  it('negeert custom-kolommen; die komen uit tb_custom_values', () => {
    const fields = resolveCollapsedDetailFields({
      detailColumns: [ITEM_COLUMN, { key: 'remark', source: 'custom', dataType: 'string' }],
      runtimeLinks: {
        lineValueHeaderLinks: [{ lineColumnKey: 'remark', headerColumnKey: 'remarks_on_header' }],
      },
    });

    expect(fields).toEqual([{ field: 'ItemNumber', type: 'string', fallback: 'itemNumber' }]);
  });

  it('neemt het items-filterveld altijd mee', () => {
    const fields = resolveCollapsedDetailFields({
      detailColumns: [ITEM_COLUMN],
      alwaysFields: ['itemNumber'],
    });

    expect(fields).toContainEqual({ field: 'itemNumber', type: 'string' });
    expect(fields).toContainEqual({ field: 'ItemNumber', type: 'string', fallback: 'itemNumber' });
  });
});

describe('collectLinkedLineColumnKeys', () => {
  it('verzamelt total- en value-koppelingen', () => {
    expect(collectLinkedLineColumnKeys({
      lineTotalHeaderLinks: [{ lineColumnKey: 'Quantity' }],
      lineValueHeaderLinks: [{ lineColumnKey: 'itemNumber' }],
    })).toEqual(['quantity', 'itemnumber']);
  });
});

describe('buildDetailJsonFromProjection', () => {
  const fields = [
    { field: 'ItemNumber', type: 'string' },
    { field: 'PurchaseQuantity', type: 'number' },
    { field: 'IsClosed', type: 'bool' },
  ];

  it('zet de nvarchar-kolommen terug naar hun oorspronkelijke type', () => {
    expect(buildDetailJsonFromProjection({ f0: 'A-100', f1: '12.5', f2: 'true' }, fields)).toEqual({
      ItemNumber: 'A-100',
      PurchaseQuantity: 12.5,
      IsClosed: true,
    });
  });

  it('laat ontbrekende velden weg in plaats van ze op null te zetten', () => {
    expect(buildDetailJsonFromProjection({ f0: 'A-100', f1: null, f2: null }, fields)).toEqual({
      ItemNumber: 'A-100',
    });
  });

  it('houdt een onleesbaar getal als ruwe waarde', () => {
    expect(buildDetailJsonFromProjection({ f1: 'n/a' }, fields).PurchaseQuantity).toBe('n/a');
  });
});

describe('buildDetailProjectionSql', () => {
  it('bouwt een genummerde JSON_VALUE-projectie', () => {
    expect(buildDetailProjectionSql([
      { field: 'ItemNumber', type: 'string' },
      { field: 'PurchaseQuantity', type: 'number' },
    ])).toBe("JSON_VALUE(data_json, '$.ItemNumber') AS f0, JSON_VALUE(data_json, '$.PurchaseQuantity') AS f1");
  });

  it('probeert ook de kolomsleutel wanneer die als fallback is meegegeven', () => {
    expect(buildDetailProjectionSql([{ field: 'ItemNumber', type: 'string', fallback: 'itemNumber' }]))
      .toBe("COALESCE(JSON_VALUE(data_json, '$.ItemNumber'), JSON_VALUE(data_json, '$.itemNumber')) AS f0");
  });
});
