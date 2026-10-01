import { describe, expect, it } from 'vitest';
import { isoWeekStartUtc } from './rccpUtils';
import {
  RCCP_PERIOD_GRAIN_MONTH,
  RCCP_PERIOD_GRAIN_WEEK,
  RCCP_PLANNING_DATE_CONFIRMED,
  RCCP_PLANNING_DATE_REQUESTED,
  monthBucketFromIsoWeek,
  parseRccpPeriodGrain,
  parseRccpPlanningDateMode,
  parseRccpPlanningDateModes,
  primaryRccpPlanningDateMode,
  rccpPlanningDateMarker,
  rccpPlanningDateModeList,
  isRccpDualPlanningDate,
  resolveRccpChartView,
  secondaryRccpPlanningDateMode,
  toggleRccpPlanningDateMode,
} from './rccpPeriodGrain';

describe('monthBucketFromIsoWeek', () => {
  it('assigns an ISO week to the calendar month of its Monday', () => {
    const monday = isoWeekStartUtc(2026, 12);
    expect(monday.getUTCFullYear()).toBe(2026);
    expect(monday.getUTCMonth()).toBe(2);
    expect(monthBucketFromIsoWeek(2026, 12)).toEqual({
      year: 2026,
      month: 3,
      key: '2026-M03',
    });
  });

  it('puts ISO week 1 of 2026 in December 2025', () => {
    expect(monthBucketFromIsoWeek(2026, 1)).toEqual({
      year: 2025,
      month: 12,
      key: '2025-M12',
    });
  });
});

describe('resolveRccpChartView', () => {
  const periods = [
    { year: 2026, week: 10, key: '2026-W10' },
    { year: 2026, week: 11, key: '2026-W11' },
    { year: 2026, week: 12, key: '2026-W12' },
  ];
  const chart = [
    {
      key: '2026-W10', year: 2026, week: 10, open: 10, __capacity__: 40, __overloaded__: false,
      segmentsAbove: [{ itemNumber: 'A', qty: 10, status: 'open', late: false, dataAreaId: '' }],
      segmentsBelow: [],
    },
    {
      key: '2026-W11', year: 2026, week: 11, open: 30, __capacity__: 40, __overloaded__: false,
      segmentsAbove: [{ itemNumber: 'A', qty: 20, status: 'open', late: true, dataAreaId: '' }],
      segmentsBelow: [{ itemNumber: 'B', qty: 5, status: 'received', late: false, dataAreaId: '' }],
    },
    {
      key: '2026-W12', year: 2026, week: 12, open: 50, __capacity__: 40, __overloaded__: true,
      segmentsAbove: [],
      segmentsBelow: [],
    },
  ];
  const cells = [
    {
      measureKey: 'open', periodYear: 2026, isoWeek: 10, vendorAccount: 'V1',
      confirmedQty: 10, availableQty: 40, statusColor: 'green', statusLabel: 'OK',
    },
    {
      measureKey: 'open', periodYear: 2026, isoWeek: 11, vendorAccount: 'V1',
      confirmedQty: 30, availableQty: 40, statusColor: 'orange', statusLabel: 'Warning',
    },
    {
      measureKey: 'open', periodYear: 2026, isoWeek: 12, vendorAccount: 'V1',
      confirmedQty: 50, availableQty: 40, statusColor: 'red', statusLabel: 'Shortage',
    },
  ];

  it('returns the original week view unchanged', () => {
    const view = resolveRccpChartView({
      grain: RCCP_PERIOD_GRAIN_WEEK, periods, chart, cells,
    });
    expect(view.periods).toBe(periods);
    expect(view.chart).toBe(chart);
    expect(view.cellMap.get('open|2026|10').confirmedQty).toBe(10);
  });

  it('sums every vendor in the same week', () => {
    const view = resolveRccpChartView({
      grain: RCCP_PERIOD_GRAIN_WEEK,
      periods: [{ year: 2026, week: 10, key: '2026-W10' }],
      chart: [],
      cells: [
        {
          measureKey: 'open', periodYear: 2026, isoWeek: 10, vendorAccount: 'V1',
          confirmedQty: 10, availableQty: 40, remainingQty: 30, statusColor: 'green', statusLabel: 'OK',
        },
        {
          measureKey: 'open', periodYear: 2026, isoWeek: 10, vendorAccount: 'V2',
          confirmedQty: 25, availableQty: 10, remainingQty: -15, statusColor: 'red', statusLabel: 'Shortage',
        },
      ],
    });
    const cell = view.cellMap.get('open|2026|10');
    expect(cell.confirmedQty).toBe(35);
    expect(cell.availableQty).toBe(50);
    expect(cell.remainingQty).toBe(15);
    expect(cell.statusColor).toBe('red');
  });

  it('rolls ISO weeks into calendar months and sums quantities', () => {
    const view = resolveRccpChartView({
      grain: RCCP_PERIOD_GRAIN_MONTH, periods, chart, cells,
    });
    expect(view.periods).toEqual([
      expect.objectContaining({
        year: 2026, month: 3, key: '2026-M03', week: 10, lastWeek: 12, lastYear: 2026,
      }),
    ]);
    expect(view.chart).toHaveLength(1);
    expect(view.chart[0].open).toBe(90);
    expect(view.chart[0].__capacity__).toBe(120);
    expect(view.chart[0].__overloaded__).toBe(false);
    expect(view.chart[0].segmentsAbove).toEqual([
      expect.objectContaining({ itemNumber: 'A', qty: 10, status: 'open', late: false }),
      expect.objectContaining({ itemNumber: 'A', qty: 20, status: 'open', late: true }),
    ]);
    expect(view.chart[0].segmentsBelow).toEqual([
      expect.objectContaining({ itemNumber: 'B', qty: 5, status: 'received' }),
    ]);
    expect(view.cellMap.get('open|2026|3').confirmedQty).toBe(90);
    expect(view.cellMap.get('open|2026|3').availableQty).toBe(120);
    expect(view.cellMap.get('open|2026|3').statusColor).toBe('red');
  });

  it('groups remaining above ordered when weeks roll into a month', () => {
    const view = resolveRccpChartView({
      grain: RCCP_PERIOD_GRAIN_MONTH,
      periods: [
        { year: 2026, week: 10, key: '2026-W10' },
        { year: 2026, week: 11, key: '2026-W11' },
      ],
      chart: [
        {
          key: '2026-W10', year: 2026, week: 10, open: 6,
          segmentsAbove: [
            { itemNumber: 'B', qty: 3, status: 'ordered' },
            { itemNumber: 'B', qty: 2, status: 'open' },
          ],
          segmentsBelow: [],
        },
        {
          key: '2026-W11', year: 2026, week: 11, open: 6,
          segmentsAbove: [
            { itemNumber: 'A', qty: 4, status: 'ordered' },
            { itemNumber: 'A', qty: 4, status: 'open' },
          ],
          segmentsBelow: [],
        },
      ],
      cells: [],
    });
    expect(view.chart[0].segmentsAbove.map((seg) => `${seg.itemNumber}:${seg.status}`)).toEqual([
      'A:ordered',
      'B:ordered',
      'A:open',
      'B:open',
    ]);
  });

  it('marks a month overloaded when summed load exceeds summed capacity', () => {
    const view = resolveRccpChartView({
      grain: RCCP_PERIOD_GRAIN_MONTH,
      periods: [{ year: 2026, week: 12, key: '2026-W12' }],
      chart: [{
        key: '2026-W12', year: 2026, week: 12, open: 50, __capacity__: 40, __overloaded__: true,
        segmentsAbove: [], segmentsBelow: [],
      }],
      cells: [],
    });
    expect(view.chart[0].__overloaded__).toBe(true);
  });
});

describe('parseRccpPeriodGrain', () => {
  it('defaults to week and only accepts month', () => {
    expect(parseRccpPeriodGrain(undefined)).toBe(RCCP_PERIOD_GRAIN_WEEK);
    expect(parseRccpPeriodGrain('week')).toBe(RCCP_PERIOD_GRAIN_WEEK);
    expect(parseRccpPeriodGrain('month')).toBe(RCCP_PERIOD_GRAIN_MONTH);
    expect(parseRccpPeriodGrain('MONTH')).toBe(RCCP_PERIOD_GRAIN_MONTH);
    expect(parseRccpPeriodGrain('other')).toBe(RCCP_PERIOD_GRAIN_WEEK);
  });
});

describe('parseRccpPlanningDateMode', () => {
  it('defaults to requested and only accepts confirmed', () => {
    expect(parseRccpPlanningDateMode(undefined)).toBe(RCCP_PLANNING_DATE_REQUESTED);
    expect(parseRccpPlanningDateMode('requested')).toBe(RCCP_PLANNING_DATE_REQUESTED);
    expect(parseRccpPlanningDateMode('confirmed')).toBe(RCCP_PLANNING_DATE_CONFIRMED);
    expect(parseRccpPlanningDateMode('CONFIRMED')).toBe(RCCP_PLANNING_DATE_CONFIRMED);
    expect(parseRccpPlanningDateMode('other')).toBe(RCCP_PLANNING_DATE_REQUESTED);
  });
});

describe('parseRccpPlanningDateModes', () => {
  it('reads the legacy single mode string', () => {
    expect(parseRccpPlanningDateModes('requested')).toEqual({ requested: true, confirmed: false });
    expect(parseRccpPlanningDateModes('confirmed')).toEqual({ requested: false, confirmed: true });
  });

  it('reads an array or flag object and keeps at least one mode on', () => {
    expect(parseRccpPlanningDateModes(['requested', 'confirmed']))
      .toEqual({ requested: true, confirmed: true });
    expect(parseRccpPlanningDateModes({ requested: false, confirmed: true }))
      .toEqual({ requested: false, confirmed: true });
    expect(parseRccpPlanningDateModes([])).toEqual({ requested: true, confirmed: false });
    expect(parseRccpPlanningDateModes({ requested: false, confirmed: false }))
      .toEqual({ requested: true, confirmed: false });
  });

  it('lists active modes with requested first', () => {
    expect(rccpPlanningDateModeList({ requested: true, confirmed: true }))
      .toEqual([RCCP_PLANNING_DATE_REQUESTED, RCCP_PLANNING_DATE_CONFIRMED]);
    expect(rccpPlanningDateModeList('confirmed')).toEqual([RCCP_PLANNING_DATE_CONFIRMED]);
    expect(primaryRccpPlanningDateMode({ requested: false, confirmed: true }))
      .toBe(RCCP_PLANNING_DATE_CONFIRMED);
    expect(secondaryRccpPlanningDateMode({ requested: true, confirmed: true }))
      .toBe(RCCP_PLANNING_DATE_CONFIRMED);
    expect(secondaryRccpPlanningDateMode('requested')).toBeNull();
    expect(isRccpDualPlanningDate({ requested: true, confirmed: true })).toBe(true);
    expect(isRccpDualPlanningDate('confirmed')).toBe(false);
  });
});

describe('toggleRccpPlanningDateMode', () => {
  it('turns a mode on and off', () => {
    expect(toggleRccpPlanningDateMode('requested', 'confirmed', true))
      .toEqual({ requested: true, confirmed: true });
    expect(toggleRccpPlanningDateMode({ requested: true, confirmed: true }, 'requested', false))
      .toEqual({ requested: false, confirmed: true });
  });

  it('refuses to switch off the last active mode', () => {
    expect(toggleRccpPlanningDateMode('requested', 'requested', false))
      .toEqual({ requested: true, confirmed: false });
  });

  it('ignores an unknown mode', () => {
    expect(toggleRccpPlanningDateMode('requested', 'other', true))
      .toEqual({ requested: true, confirmed: false });
  });
});

describe('rccpPlanningDateMarker', () => {
  it('marks requested with R and confirmed with C', () => {
    expect(rccpPlanningDateMarker(RCCP_PLANNING_DATE_REQUESTED)).toBe('R');
    expect(rccpPlanningDateMarker(RCCP_PLANNING_DATE_CONFIRMED)).toBe('C');
  });
});
