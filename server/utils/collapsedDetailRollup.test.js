'use strict';

const {
  resolveCollapsedRollupPlan,
  buildCollapsedRollupSql,
  parseCollapsedRollupRows,
  parseValueList,
  LIST_SEPARATOR,
} = require('./collapsedDetailRollup');

const ITEM_COLUMN = { key: 'itemNumber', source: 'source', sourceField: 'ItemNumber', dataType: 'string' };
const QTY_COLUMN = { key: 'quantity', source: 'source', sourceField: 'PurchaseQuantity', dataType: 'number' };

describe('resolveCollapsedRollupPlan', () => {
  it('zoekt het itemveld op bronveld en op kolomsleutel', () => {
    const plan = resolveCollapsedRollupPlan({ detailColumns: [ITEM_COLUMN, QTY_COLUMN] });

    expect(plan).toEqual({ itemFields: ['ItemNumber', 'itemNumber'], totalLinks: [], valueLinks: [] });
  });

  it('neemt een total-koppeling naar een bronkolom op', () => {
    const plan = resolveCollapsedRollupPlan({
      detailColumns: [ITEM_COLUMN, QTY_COLUMN],
      runtimeLinks: { lineTotalHeaderLinks: [{ lineColumnKey: 'quantity', headerColumnKey: 'qty_total' }] },
    });

    expect(plan.totalLinks).toEqual([
      { headerColumnKey: 'qty_total', fields: ['PurchaseQuantity', 'quantity'], numeric: true },
    ]);
  });

  it('weigert te aggregeren zodra een koppeling naar een formulekolom wijst', () => {
    const plan = resolveCollapsedRollupPlan({
      detailColumns: [ITEM_COLUMN, { key: 'openQty', source: 'custom', formulaExpr: '[quantity] - 1' }],
      runtimeLinks: { lineTotalHeaderLinks: [{ lineColumnKey: 'openQty', headerColumnKey: 'open_total' }] },
    });

    expect(plan).toBeNull();
  });

  it('weigert te aggregeren zodra een koppeling naar een lookup-kolom wijst', () => {
    const plan = resolveCollapsedRollupPlan({
      detailColumns: [ITEM_COLUMN],
      runtimeLinks: { lineValueHeaderLinks: [{ lineColumnKey: 'items_searchName', headerColumnKey: 'item_values' }] },
    });

    expect(plan).toBeNull();
  });

  it('weigert te aggregeren als het items-syncfilter actief is', () => {
    const plan = resolveCollapsedRollupPlan({ detailColumns: [ITEM_COLUMN], itemsFilterActive: true });

    expect(plan).toBeNull();
  });

  it('laat itemFields leeg als de kolom itemNumber niet bestaat', () => {
    const plan = resolveCollapsedRollupPlan({ detailColumns: [QTY_COLUMN] });

    expect(plan.itemFields).toBeNull();
  });
});

describe('buildCollapsedRollupSql', () => {
  const plan = {
    itemFields: ['ItemNumber', 'itemNumber'],
    totalLinks: [{ headerColumnKey: 'qty_total', fields: ['PurchaseQuantity', 'quantity'], numeric: true }],
    valueLinks: [{ headerColumnKey: 'item_values', fields: ['ItemNumber'], numeric: false }],
  };

  it('groepeert per order en telt de gekoppelde kolommen op', () => {
    const sql = buildCollapsedRollupSql(plan, { enabled: true, exclusive: false });

    expect(sql).toContain('GROUP BY partition_key, record_key');
    expect(sql).toContain('SUM(t0) AS total0');
    expect(sql).toContain('STRING_AGG(CAST(v0 AS nvarchar(max)), CHAR(31))');
    expect(sql).toContain("JSON_VALUE(data_json, '$.PurchaseQuantity')");
    expect(sql).toContain('first_seen_at >= @baselineAt');
  });

  it('valt terug op de kolomsleutel als het bronveld niet in de blob staat', () => {
    const sql = buildCollapsedRollupSql(plan, { enabled: true, exclusive: false });

    expect(sql).toContain("COALESCE(JSON_VALUE(data_json, '$.ItemNumber'), JSON_VALUE(data_json, '$.itemNumber'))");
  });

  it('gebruikt een exclusieve vergelijking bij een viewed-baseline', () => {
    expect(buildCollapsedRollupSql(plan, { enabled: true, exclusive: true })).toContain('first_seen_at > @baselineAt');
  });

  it('zet de activiteitsvlaggen op 0 zonder baseline', () => {
    const sql = buildCollapsedRollupSql(plan, { enabled: false, exclusive: false });

    expect(sql).toContain('0 AS is_new');
    expect(sql).not.toContain('@baselineAt');
  });
});

describe('parseCollapsedRollupRows', () => {
  const plan = {
    itemFields: ['ItemNumber', 'itemNumber'],
    totalLinks: [{ headerColumnKey: 'qty_total', fields: ['PurchaseQuantity'], numeric: true }],
    valueLinks: [{ headerColumnKey: 'item_values', fields: ['ItemNumber'], numeric: false }],
  };

  it('bouwt de rollup per order op', () => {
    const rollup = parseCollapsedRollupRows([{
      partition_key: 'whsl',
      record_key: 'WSPO-001',
      detail_count: 3,
      has_new_line: 1,
      has_changed_line: 0,
      has_removed_line: 0,
      unique_item_count: 2,
      first_item_marker: '000000001001A-100',
      total0: 12.5,
      list0: ['A-100', 'B-200', 'A-100'].join(LIST_SEPARATOR),
    }], plan);

    expect(rollup.get('whsl|WSPO-001')).toEqual({
      detailCount: 3,
      hasNewLine: true,
      hasChangedLine: false,
      hasRemovedLine: false,
      firstItemNumber: 'A-100',
      uniqueItemCount: 2,
      totals: { qty_total: 12.5 },
      values: { item_values: ['A-100', 'B-200'] },
    });
  });

  it('maakt van een lege som een nul, zoals calculateLinkedLineTotal', () => {
    const rollup = parseCollapsedRollupRows([{
      partition_key: 'whsl', record_key: 'WSPO-002', detail_count: 1, total0: null, list0: null,
    }], plan);

    expect(rollup.get('whsl|WSPO-002').totals.qty_total).toBe(0);
    expect(rollup.get('whsl|WSPO-002').values.item_values).toEqual([]);
  });
});

describe('parseValueList', () => {
  it('ontdubbelt, trimt en slaat streepjes over', () => {
    const raw = ['Item A', ' Item A ', '-', '', 'Item B'].join(LIST_SEPARATOR);

    expect(parseValueList(raw, false)).toEqual(['Item A', 'Item B']);
  });

  it('zet numerieke koppelingen terug naar getallen', () => {
    expect(parseValueList(['12,5', '3'].join(LIST_SEPARATOR), true)).toEqual([12.5, 3]);
  });
});
