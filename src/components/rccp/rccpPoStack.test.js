import { describe, expect, it } from 'vitest';
import {
  todayLineX,
  todayBand,
  stackRectLayout,
  isoWeekPartsUtc,
  RCCP_PO_BAR_SIZE,
  weekBarBox,
  isReceivedPairHighlight,
  poSegmentStroke,
  isCurrentMatrixPeriod,
  rccpChartYDomain,
  rccpNiceYExtent,
  rccpChartYAxisScale,
  rccpChartYTicks,
  rccpPoStackBarFlags,
  visibleAboveSegments,
  rccpLoadDateBarLayout,
  RCCP_DUAL_BAR_OVERLAP,
  RCCP_DUAL_PO_BAR_SIZE,
  RCCP_PO_BAR_SIZE_BELOW,
} from './rccpPoStack';
import { RCCP_CHART_Y_AXIS_WIDTH, RCCP_WEEK_COL_WIDTH } from './rccpUtils';

describe('rccpPoStack', () => {
  it('uses 75% of the week column as bar width', () => {
    expect(RCCP_PO_BAR_SIZE).toBe(Math.round(RCCP_WEEK_COL_WIDTH * 0.75));
  });

  it('centers a bar inside the week band', () => {
    expect(weekBarBox(0, RCCP_PO_BAR_SIZE).width).toBe(RCCP_PO_BAR_SIZE);
    expect(weekBarBox(0, RCCP_PO_BAR_SIZE).x).toBe(
      RCCP_CHART_Y_AXIS_WIDTH + (RCCP_WEEK_COL_WIDTH - RCCP_PO_BAR_SIZE) / 2,
    );
    expect(weekBarBox(1, RCCP_PO_BAR_SIZE).x).toBe(
      RCCP_CHART_Y_AXIS_WIDTH + RCCP_WEEK_COL_WIDTH + (RCCP_WEEK_COL_WIDTH - RCCP_PO_BAR_SIZE) / 2,
    );
  });

  it('shifts a bar by the given offset', () => {
    const centered = weekBarBox(0, RCCP_PO_BAR_SIZE);
    expect(weekBarBox(0, RCCP_PO_BAR_SIZE, 6).x).toBe(centered.x + 6);
    expect(weekBarBox(0, RCCP_PO_BAR_SIZE, -6).x).toBe(centered.x - 6);
  });

  it('keeps one centered bar at the same width as the below-axis bar when a single load date is active', () => {
    expect(rccpLoadDateBarLayout(false))
      .toEqual({ barSize: RCCP_PO_BAR_SIZE_BELOW, primaryOffset: 0, secondaryOffset: 0 });
  });

  it('overlaps the two load-date bars by 25% and keeps them inside the week column', () => {
    const { barSize, primaryOffset, secondaryOffset } = rccpLoadDateBarLayout(true);
    const requested = weekBarBox(0, barSize, primaryOffset);
    const confirmed = weekBarBox(0, barSize, secondaryOffset);
    const overlap = (requested.x + requested.width) - confirmed.x;
    expect(overlap).toBeCloseTo(barSize * RCCP_DUAL_BAR_OVERLAP, 6);
    expect(requested.x).toBeGreaterThanOrEqual(RCCP_CHART_Y_AXIS_WIDTH);
    expect(confirmed.x + confirmed.width)
      .toBeLessThanOrEqual(RCCP_CHART_Y_AXIS_WIDTH + RCCP_WEEK_COL_WIDTH);
    expect(barSize).toBe(RCCP_DUAL_PO_BAR_SIZE);
    expect(barSize).toBeLessThan(RCCP_PO_BAR_SIZE);
  });

  it('returns null for todayLineX when the current week is outside the window', () => {
    const periods = [{ key: '2020-W01', year: 2020, week: 1 }];
    expect(todayLineX(periods, new Date('2026-03-16T00:00:00.000Z'))).toBeNull();
  });

  it('uses the ISO week-1 Monday (Jan 4 method) when 1 Jan is a Friday', () => {
    const parts = isoWeekPartsUtc(new Date('2021-11-08T12:00:00.000Z'));
    expect(parts).toMatchObject({ year: 2021, week: 45, key: '2021-W45', weekday: 1 });
    expect(isoWeekPartsUtc(new Date('2021-11-19T12:00:00.000Z')).week).toBe(46);
    expect(isoWeekPartsUtc(new Date('2021-12-10T12:00:00.000Z')).week).toBe(49);
  });

  it('places the today line on the real weekday inside the current ISO week column', () => {
    const now = new Date('2026-03-18T12:00:00.000Z'); // Wednesday
    const parts = isoWeekPartsUtc(now);
    expect(parts.weekday).toBe(3);
    const periods = [{ key: parts.key, year: parts.year, week: parts.week }];
    const x = todayLineX(periods, now);
    expect(x).toBe(
      RCCP_CHART_Y_AXIS_WIDTH + (0 + (3 - 0.5) / 7) * RCCP_WEEK_COL_WIDTH,
    );
  });

  it('returns a full-column band for the current period', () => {
    const now = new Date('2026-03-18T12:00:00.000Z');
    const parts = isoWeekPartsUtc(now);
    const periods = [{ key: parts.key, year: parts.year, week: parts.week }];
    const band = todayBand(periods, now);
    expect(band.index).toBe(0);
    expect(band.bandX).toBe(RCCP_CHART_Y_AXIS_WIDTH);
    expect(band.bandWidth).toBe(RCCP_WEEK_COL_WIDTH);
    expect(band.todayX).toBe(todayLineX(periods, now));
  });

  it('places the today line by day-of-month inside a month column', () => {
    const now = new Date('2026-03-16T12:00:00.000Z');
    const periods = [{ key: '2026-M03', year: 2026, month: 3, week: 10, lastWeek: 13 }];
    const x = todayLineX(periods, now);
    expect(x).toBe(
      RCCP_CHART_Y_AXIS_WIDTH + (0 + (16 - 0.5) / 31) * RCCP_WEEK_COL_WIDTH,
    );
  });

  it('stacks received against the axis then open outward', () => {
    const segments = [
      { poNumber: 'PO-A', qty: 4, status: 'received' },
      { poNumber: 'PO-A', qty: 6, status: 'open' },
    ];
    const above = stackRectLayout(segments, 10, 100, 'above');
    expect(above[0].segment.status).toBe('received');
    expect(above[0].y + above[0].height).toBe(110);
    expect(above[1].segment.status).toBe('open');
    expect(above[1].y).toBe(10);
    const below = stackRectLayout(segments, 110, 50, 'below');
    expect(below[0].y).toBe(110);
    expect(below[1].y).toBe(110 + 20);
  });

  it('anchors below-axis bars to the zero line when Recharts sends negative height', () => {
    const segments = [{ poNumber: 'PO-A', qty: 10, status: 'received' }];
    const below = stackRectLayout(segments, 160, -50, 'below');
    expect(below[0].y).toBe(110);
    expect(below[0].height).toBe(50);
  });

  it('highlights matching received segments of the same item', () => {
    expect(isReceivedPairHighlight({ status: 'received', itemNumber: 'SKU-1' }, 'SKU-1')).toBe(true);
    expect(isReceivedPairHighlight({ status: 'received', itemNumber: 'SKU-2' }, 'SKU-1')).toBe(false);
    expect(isReceivedPairHighlight({ status: 'open', itemNumber: 'SKU-1' }, 'SKU-1')).toBe(false);
    expect(isReceivedPairHighlight({ status: 'ordered', itemNumber: 'SKU-1' }, 'SKU-1')).toBe(true);
    expect(isReceivedPairHighlight({ status: 'received', itemNumber: 'SKU-1' }, '')).toBe(false);
  });

  it('does not draw a late outline on received boxes', () => {
    expect(poSegmentStroke({ status: 'received', late: true }, false)).toEqual({
      stroke: 'none', strokeWidth: 0,
    });
    expect(poSegmentStroke({ status: 'received', late: true }, true).strokeWidth).toBeGreaterThan(0);
  });

  it('keeps 0 in the Y domain and matches the scale above and below the axis', () => {
    expect(rccpChartYDomain([
      { __stackAbove: 1601, __stackBelow: 0, remaining: 21 },
      { __stackAbove: 0, __stackBelow: -3000, remaining: 0 },
    ], ['remaining'])).toEqual([-3000, 3000]);
  });

  it('snaps the Y extent to the next round step instead of the next power of ten', () => {
    expect(rccpNiceYExtent(100)).toBe(100);
    expect(rccpNiceYExtent(21)).toBe(25);
    expect(rccpNiceYExtent(240)).toBe(250);
    expect(rccpNiceYExtent(501)).toBe(600);
    expect(rccpNiceYExtent(1601)).toBe(2000);
    expect(rccpNiceYExtent(3000)).toBe(3000);
  });

  it('keeps the axis close to the highest bar', () => {
    // Een top van 1600 mag niet op een as van 5000 uitkomen: hooguit 25% lucht boven de balk.
    for (const peak of [180, 640, 1601, 2400, 4200, 9100]) {
      const [, max] = rccpChartYDomain([{ __stackAbove: peak, __stackBelow: 0 }]);
      expect(max).toBeGreaterThanOrEqual(peak);
      expect(max).toBeLessThanOrEqual(peak * 1.25);
    }
  });

  it('forces Recharts to keep equal scale when visible series are one-sided', () => {
    const props = rccpChartYAxisScale([-3000, 3000]);
    expect(props.type).toBe('number');
    expect(props.allowDataOverflow).toBe(true);
    expect(props.domain).toEqual([-3000, 3000]);
    expect(props.ticks).toEqual([-3000, -1500, 0, 1500, 3000]);
    expect(Math.abs(props.domain[0])).toBe(Math.abs(props.domain[1]));
  });

  it('starts the axis at zero when nothing is drawn below it', () => {
    expect(rccpChartYDomain([{ __stackAbove: 1601, __stackBelow: 0 }])).toEqual([0, 2000]);
    const props = rccpChartYAxisScale([0, 2000]);
    expect(props.domain).toEqual([0, 2000]);
    expect(props.ticks).toEqual([0, 500, 1000, 1500, 2000]);
  });

  it('labels every gridline on round steps', () => {
    // Vier stappen op een as vanaf nul, twee per kant op een symmetrische as.
    expect(rccpChartYTicks([0, 8000]).ticks).toEqual([8000, 6000, 4000, 2000, 0]);
    expect(rccpChartYTicks([-8000, 8000]).ticks).toEqual([8000, 4000, 0, -4000, -8000]);
    expect(rccpChartYTicks([-3000, 3000]).ticks).toEqual([3000, 1500, 0, -1500, -3000]);
    expect(rccpChartYTicks([0, 2400]).ticks).toEqual([2500, 2000, 1500, 1000, 500, 0]);
  });

  it('keeps the outer values on the axis and never leaves a gridline unlabelled', () => {
    for (const peak of [180, 640, 1601, 2400, 4200, 9100, 14305]) {
      for (const domain of [[0, peak], [-peak, peak]]) {
        const { ticks, extent, step } = rccpChartYTicks(domain);
        expect(ticks[0]).toBe(extent);
        expect(ticks[ticks.length - 1]).toBe(domain[0] < 0 ? -extent : 0);
        expect(ticks.length).toBeGreaterThanOrEqual(3);
        // Elke tick is een veelvoud van de stap: geen 1/3-waarden op de as.
        ticks.forEach((tick) => expect(Math.abs(tick % step)).toBeLessThan(1e-6));
      }
    }
  });

  it('groups remaining segments together against the axis', () => {
    expect(visibleAboveSegments([
      { itemNumber: 'SKU-A', qty: 4, status: 'ordered' },
      { itemNumber: 'SKU-A', qty: 6, status: 'open' },
      { itemNumber: 'SKU-B', qty: 3, status: 'ordered' },
      { itemNumber: 'SKU-B', qty: 2, status: 'open' },
    ], { openVisible: true, orderedVisible: true }).map((seg) => `${seg.itemNumber}:${seg.status}`)).toEqual([
      'SKU-A:open',
      'SKU-B:open',
      'SKU-A:ordered',
      'SKU-B:ordered',
    ]);
  });

  it('keeps remaining boxes when quantity is off and remaining stays on', () => {
    const remaining = visibleAboveSegments([
      { itemNumber: 'SKU-A', qty: 4, status: 'ordered' },
      { itemNumber: 'SKU-A', qty: 6, status: 'open' },
      { itemNumber: 'SKU-B', qty: 2, status: 'open' },
    ], { openVisible: true, orderedVisible: false });
    expect(remaining.map((seg) => `${seg.itemNumber}:${seg.status}`)).toEqual([
      'SKU-A:open',
      'SKU-B:open',
    ]);
    expect(remaining.reduce((sum, seg) => sum + seg.qty, 0)).toBe(8);
  });

  it('does not collapse to a negative-only axis when quantity sits in the above stack', () => {
    const domain = rccpChartYDomain([
      { __stackAbove: 14305, __stackBelow: -12 },
    ]);
    expect(domain[0]).toBeLessThan(0);
    expect(domain[1]).toBeGreaterThan(0);
  });

  it('shows the above stack when only quantity (ordered) is toggled on', () => {
    expect(rccpPoStackBarFlags({
      openVisible: false, orderedVisible: true, deliveredVisible: false,
    })).toEqual({ showAbove: true, showAboveAlt: false, showBelow: false });
    expect(rccpPoStackBarFlags({
      openVisible: false, orderedVisible: false, deliveredVisible: true,
    })).toEqual({ showAbove: true, showAboveAlt: false, showBelow: true });
  });

  it('adds the second load-date stack only when both load dates are on', () => {
    expect(rccpPoStackBarFlags({
      openVisible: true, orderedVisible: false, deliveredVisible: false, dual: true,
    })).toEqual({ showAbove: true, showAboveAlt: true, showBelow: false });
    expect(rccpPoStackBarFlags({
      openVisible: false, orderedVisible: false, deliveredVisible: false, dual: true,
    })).toEqual({ showAbove: false, showAboveAlt: false, showBelow: false });
  });

  it('detects the current week and month period', () => {
    const now = new Date('2026-03-18T12:00:00.000Z');
    const parts = isoWeekPartsUtc(now);
    expect(isCurrentMatrixPeriod({ key: parts.key, year: parts.year, week: parts.week }, now)).toBe(true);
    expect(isCurrentMatrixPeriod({ key: '2020-W01', year: 2020, week: 1 }, now)).toBe(false);
    expect(isCurrentMatrixPeriod({ key: '2026-M03', year: 2026, month: 3 }, now)).toBe(true);
    expect(isCurrentMatrixPeriod({ key: '2026-M02', year: 2026, month: 2 }, now)).toBe(false);
  });
});
