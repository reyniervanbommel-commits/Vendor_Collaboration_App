'use strict';

const { getIsoWeek, getIsoWeekYear, isoWeekKey } = require('./isoWeek');
const { buildPoSegments, mergeSegmentsIntoChart } = require('./rccpPoSegments');

function weekOf(date) {
  return { year: getIsoWeekYear(date), week: getIsoWeek(date), key: isoWeekKey(getIsoWeekYear(date), getIsoWeek(date)) };
}

describe('buildPoSegments', () => {
  const planned = '2026-03-16T00:00:00.000Z'; // ISO week of this date
  const received = '2026-03-30T00:00:00.000Z';
  const plannedWeek = weekOf(planned);
  const receivedWeek = weekOf(received);
  const nowCurrent = new Date(planned);
  const nowNext = new Date('2026-03-23T00:00:00.000Z');

  const baseConfig = {
    dateColumnKey: 'requestedDeliveryDate',
    receiptDateColumnKey: 'productReceiptDate',
    vendorColumnKey: 'vendorAccount',
    openMeasureKey: 'openQty',
    deliveredMeasureKey: 'deliveredQty',
    orderedMeasureKey: 'orderedQty',
    excludedStatuses: ['Canceled'],
    confirmedDateColumnKey: 'confirmedDeliveryDate',
  };

  const window = {
    fromYear: plannedWeek.year,
    fromWeek: Math.min(plannedWeek.week, receivedWeek.week),
    toYear: receivedWeek.year,
    toWeek: Math.max(plannedWeek.week, receivedWeek.week),
  };

  function row(overrides = {}) {
    return {
      recordKey: 'PO-A',
      partitionKey: 'whsl',
      values: { vendorAccount: 'V001', status: 'Open', dataAreaId: 'whsl', ...(overrides.values || {}) },
      details: overrides.details || [{
        detailKey: '1',
        values: {
          requestedDeliveryDate: planned,
          confirmedDeliveryDate: planned,
          productReceiptDate: received,
          openQty: 10,
          deliveredQty: 4,
          orderedQty: 14,
          itemNumber: 'SKU-1',
          ...(overrides.line || {}),
        },
      }],
    };
  }

  function seg(itemNumber, qty, status, late, extra = {}) {
    return {
      itemNumber,
      poNumber: extra.poNumber || 'PO-A',
      qty,
      status,
      late,
      onTime: Boolean(extra.onTime),
      planned1900: Boolean(extra.planned1900),
      dataAreaId: extra.dataAreaId || 'whsl',
    };
  }

  it('stacks ordered-minus-open above and received below when confirmed date exists', () => {
    const byWeek = buildPoSegments([row()], baseConfig, window, { now: nowCurrent });
    const above = byWeek.get(plannedWeek.key).segmentsAbove;
    const below = byWeek.get(receivedWeek.key).segmentsBelow;
    expect(above).toEqual([
      seg('SKU-1', 4, 'ordered', false),
      seg('SKU-1', 10, 'open', false),
    ]);
    expect(below).toEqual([
      seg('SKU-1', 4, 'received', true),
    ]);
    expect(byWeek.get(plannedWeek.key).segmentsBelow).toEqual([]);
  });

  it('still places received below on the receipt week when confirmed date is empty', () => {
    const byWeek = buildPoSegments([row({ line: { confirmedDeliveryDate: '' } })], baseConfig, window, { now: nowCurrent });
    expect(byWeek.get(receivedWeek.key).segmentsBelow).toEqual([
      seg('SKU-1', 4, 'received', true),
    ]);
    expect(byWeek.get(plannedWeek.key).segmentsAbove.find((s) => s.status === 'open')?.qty).toBe(10);
  });

  it('places received below on the planned week when receipt date is empty', () => {
    const config = { ...baseConfig, receiptDateColumnKey: '', confirmedDateColumnKey: 'confirmedDeliveryDate' };
    const byWeek = buildPoSegments([row({ line: { productReceiptDate: '', confirmedDeliveryDate: planned } })], config, window, {
      now: nowCurrent,
    });
    expect(byWeek.get(plannedWeek.key).segmentsBelow).toEqual([
      seg('SKU-1', 4, 'received', false, { onTime: true }),
    ]);
    expect(byWeek.get(receivedWeek.key).segmentsBelow).toEqual([]);
  });

  it('marks open as late when the planned week is strictly before now', () => {
    const byWeek = buildPoSegments([row()], baseConfig, window, { now: nowNext });
    const open = byWeek.get(plannedWeek.key).segmentsAbove.find((s) => s.status === 'open');
    expect(open.late).toBe(true);
    const receivedSeg = byWeek.get(plannedWeek.key).segmentsAbove.find((s) => s.status === 'ordered');
    expect(receivedSeg.late).toBe(false);
  });

  it('does not mark open in the current ISO week as late', () => {
    const byWeek = buildPoSegments([row()], baseConfig, window, { now: nowCurrent });
    const open = byWeek.get(plannedWeek.key).segmentsAbove.find((s) => s.status === 'open');
    expect(open.late).toBe(false);
  });

  it('keeps received-below when planned week is outside the window', () => {
    const clipWindow = {
      fromYear: receivedWeek.year,
      fromWeek: receivedWeek.week,
      toYear: receivedWeek.year,
      toWeek: receivedWeek.week,
    };
    const byWeek = buildPoSegments([row()], baseConfig, clipWindow, { now: nowCurrent });
    expect(byWeek.get(receivedWeek.key).segmentsBelow).toEqual([
      seg('SKU-1', 4, 'received', true),
    ]);
    expect(byWeek.get(receivedWeek.key).segmentsAbove).toEqual([]);
    expect(byWeek.has(plannedWeek.key)).toBe(false);
  });

  it('filters other vendors when vendorAccount is set', () => {
    const other = row({ values: { vendorAccount: 'V999' }, line: { itemNumber: 'SKU-X' } });
    other.recordKey = 'PO-X';
    const byWeek = buildPoSegments([row(), other], baseConfig, window, {
      now: nowCurrent,
      vendorAccount: 'V001',
    });
    const items = byWeek.get(plannedWeek.key).segmentsAbove.map((s) => s.itemNumber);
    expect(items).not.toContain('SKU-X');
    expect(items).toContain('SKU-1');
  });

  it('sorts unique items and stacks received against the axis then open', () => {
    const b = row({ line: { itemNumber: 'SKU-B' } });
    b.recordKey = 'PO-B';
    const a = row({ line: { itemNumber: 'SKU-A' } });
    a.recordKey = 'PO-A';
    const byWeek = buildPoSegments([b, a], baseConfig, window, { now: nowCurrent });
    expect(byWeek.get(plannedWeek.key).segmentsAbove.map((s) => `${s.itemNumber}:${s.status}`)).toEqual([
      'SKU-A:ordered',
      'SKU-B:ordered',
      'SKU-A:open',
      'SKU-B:open',
    ]);
  });

  it('emits one stack per PO when the same item appears on two orders', () => {
    const second = row();
    second.recordKey = 'PO-B';
    const byWeek = buildPoSegments([row(), second], baseConfig, window, { now: nowCurrent });
    const above = byWeek.get(plannedWeek.key).segmentsAbove;
    expect(above.filter((s) => s.itemNumber === 'SKU-1' && s.status === 'open')).toEqual([
      seg('SKU-1', 10, 'open', false, { poNumber: 'PO-A' }),
      seg('SKU-1', 10, 'open', false, { poNumber: 'PO-B' }),
    ]);
  });

  it('skips zero and negative quantities', () => {
    const byWeek = buildPoSegments([row({ line: { openQty: 0, deliveredQty: -3, orderedQty: 0 } })], baseConfig, window, {
      now: nowCurrent,
    });
    expect(byWeek.get(plannedWeek.key).segmentsAbove).toEqual([]);
    expect(byWeek.get(receivedWeek.key).segmentsBelow).toEqual([]);
  });

  it('uses the order partitionKey even when the line has another dataAreaId', () => {
    const byWeek = buildPoSegments(
      [row({ line: { dataAreaId: 'not-a-company-code' } })],
      baseConfig,
      window,
      { now: nowCurrent },
    );
    expect(byWeek.get(plannedWeek.key).segmentsAbove[0].dataAreaId).toBe('whsl');
  });

  it('falls back to values.dataAreaId when partitionKey is empty', () => {
    const orphan = row();
    orphan.partitionKey = '';
    orphan.values.dataAreaId = 'nl01';
    const byWeek = buildPoSegments([orphan], baseConfig, window, { now: nowCurrent });
    expect(byWeek.get(plannedWeek.key).segmentsAbove[0].dataAreaId).toBe('nl01');
  });

  it('merges segments onto existing chart points', () => {
    const byWeek = buildPoSegments([row()], baseConfig, window, { now: nowCurrent });
    const chart = mergeSegmentsIntoChart(
      [{ key: plannedWeek.key, year: plannedWeek.year, week: plannedWeek.week }],
      byWeek,
    );
    expect(chart[0].segmentsAbove).toHaveLength(2);
    expect(chart[0].segmentsBelow).toEqual([]);
  });

  it('marks received-below as late when the receipt date is after the planned date', () => {
    const byWeek = buildPoSegments([row()], baseConfig, window, { now: nowCurrent });
    expect(byWeek.get(receivedWeek.key).segmentsBelow[0]).toMatchObject({
      late: true,
      onTime: false,
    });
  });

  it('marks received-below as on time when the receipt date is on the planned date', () => {
    const byWeek = buildPoSegments(
      [row({ line: { productReceiptDate: planned } })],
      baseConfig,
      window,
      { now: nowCurrent },
    );
    expect(byWeek.get(plannedWeek.key).segmentsBelow[0]).toMatchObject({
      late: false,
      onTime: true,
    });
  });

  it('flags planned 1-1-1900 segments', () => {
    const sentinel = '1900-01-01T00:00:00.000Z';
    const sentinelWeek = weekOf(new Date(sentinel));
    const tight = {
      fromYear: sentinelWeek.year,
      fromWeek: sentinelWeek.week,
      toYear: sentinelWeek.year,
      toWeek: sentinelWeek.week,
    };
    const byWeek = buildPoSegments(
      [row({ line: { requestedDeliveryDate: sentinel, productReceiptDate: '' } })],
      baseConfig,
      tight,
      { now: nowCurrent },
    );
    const above = byWeek.get(sentinelWeek.key).segmentsAbove;
    expect(above.length).toBeGreaterThan(0);
    expect(above.every((seg) => seg.planned1900)).toBe(true);
  });

  it('reads scoped config keys, as stored after saving the RCCP settings', () => {
    // Na een settings-save staan de keys scoped in de config ("master:vendorAccount"). Met de
    // rauwe key vond buildPoSegments geen vendor meer en verdwenen alle staven uit de grafiek.
    const scopedConfig = {
      ...baseConfig,
      vendorColumnKey: 'master:vendorAccount',
      dateColumnKey: 'detail:requestedDeliveryDate',
      confirmedDateColumnKey: 'detail:confirmedDeliveryDate',
      receiptDateColumnKey: 'detail:productReceiptDate',
      openMeasureKey: 'detail:openQty',
      deliveredMeasureKey: 'detail:deliveredQty',
      orderedMeasureKey: 'detail:orderedQty',
    };
    const byWeek = buildPoSegments([row()], scopedConfig, window, { now: nowCurrent });
    expect(byWeek.get(plannedWeek.key)?.segmentsAbove.find((s) => s.status === 'open')?.qty).toBe(10);
    expect(byWeek.get(receivedWeek.key)?.segmentsBelow.find((s) => s.status === 'received')?.qty).toBe(4);
  });

  it('reads a scoped header-only measure from the order values', () => {
    const scopedConfig = {
      ...baseConfig,
      vendorColumnKey: 'master:vendorAccount',
      openMeasureKey: 'master:openQty',
      deliveredMeasureKey: 'master:deliveredQty',
      orderedMeasureKey: 'master:orderedQty',
    };
    const byWeek = buildPoSegments(
      [row({ values: { openQty: 8, deliveredQty: 0, orderedQty: 8 }, line: { openQty: null, deliveredQty: null, orderedQty: null } })],
      scopedConfig,
      window,
      { now: nowCurrent },
    );
    expect(byWeek.get(plannedWeek.key)?.segmentsAbove.find((s) => s.status === 'open')?.qty).toBe(8);
  });

  it('does not double count ordered+open when open is a header-only measure but ordered is line-level', () => {
    // Regressie voor WSPO-0425331: openMeasureKey is een master-formule (bv. "OVER"),
    // orderedMeasureKey is een detail-veld ("Aantal"). Alle 50 stuks staan nog open (niets
    // ontvangen), dus de 'ordered' (filled) balk moet 0 zijn — niet nogmaals 50 naast de
    // 50 van 'open' (dat zou "Aantal" = ordered + open = 100 tonen i.p.v. 50).
    const scopedConfig = {
      ...baseConfig,
      vendorColumnKey: 'master:vendorAccount',
      openMeasureKey: 'master:openQty',
      orderedMeasureKey: 'orderedQty',
    };
    const twoLines = row({
      values: { openQty: 50 },
      details: [
        { detailKey: '1', values: { requestedDeliveryDate: planned, confirmedDeliveryDate: planned, orderedQty: 25, itemNumber: 'SKU-1' } },
        { detailKey: '2', values: { requestedDeliveryDate: planned, confirmedDeliveryDate: planned, orderedQty: 25, itemNumber: 'SKU-1' } },
      ],
    });
    const byWeek = buildPoSegments([twoLines], scopedConfig, window, { now: nowCurrent });
    const above = byWeek.get(plannedWeek.key).segmentsAbove;
    const ordered = above.filter((s) => s.status === 'ordered').reduce((sum, s) => sum + s.qty, 0);
    const open = above.filter((s) => s.status === 'open').reduce((sum, s) => sum + s.qty, 0);
    expect(open).toBe(50);
    expect(ordered).toBe(0);
  });

  it('still avoids double counting when line quantities are uneven (e.g. 20/30 split)', () => {
    const scopedConfig = {
      ...baseConfig,
      vendorColumnKey: 'master:vendorAccount',
      openMeasureKey: 'master:openQty',
      orderedMeasureKey: 'orderedQty',
    };
    const unevenLines = row({
      values: { openQty: 50 },
      details: [
        { detailKey: '1', values: { requestedDeliveryDate: planned, confirmedDeliveryDate: planned, orderedQty: 20, itemNumber: 'SKU-1' } },
        { detailKey: '2', values: { requestedDeliveryDate: planned, confirmedDeliveryDate: planned, orderedQty: 30, itemNumber: 'SKU-1' } },
      ],
    });
    const byWeek = buildPoSegments([unevenLines], scopedConfig, window, { now: nowCurrent });
    const above = byWeek.get(plannedWeek.key).segmentsAbove;
    const ordered = above.filter((s) => s.status === 'ordered').reduce((sum, s) => sum + s.qty, 0);
    const open = above.filter((s) => s.status === 'open').reduce((sum, s) => sum + s.qty, 0);
    expect(open).toBe(50);
    expect(ordered).toBe(0);
    expect(open + ordered).toBe(50);
  });

  it('places open on confirmed week when that date is real', () => {
    const requested = '2026-09-14T00:00:00.000Z';
    const confirmed = '2026-09-28T00:00:00.000Z';
    const requestedWeek = weekOf(requested);
    const confirmedWeek = weekOf(confirmed);
    const span = {
      fromYear: requestedWeek.year,
      fromWeek: Math.min(requestedWeek.week, confirmedWeek.week),
      toYear: confirmedWeek.year,
      toWeek: Math.max(requestedWeek.week, confirmedWeek.week),
    };
    const byWeek = buildPoSegments(
      [row({
        line: {
          requestedDeliveryDate: requested,
          confirmedDeliveryDate: confirmed,
          productReceiptDate: '',
        },
      })],
      { ...baseConfig, confirmedDateColumnKey: 'confirmedDeliveryDate' },
      span,
      { now: nowCurrent, planningDateMode: 'confirmed' },
    );
    const confirmedOpen = byWeek.get(confirmedWeek.key)?.segmentsAbove.find((s) => s.status === 'open');
    expect(confirmedOpen?.qty).toBe(10);
    expect(byWeek.get(requestedWeek.key)?.segmentsAbove.find((s) => s.status === 'open')).toBeUndefined();
  });
});
