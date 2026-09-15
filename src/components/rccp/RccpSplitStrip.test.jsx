// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { renderWithFluent } from '../../test-utils/render';
import RccpSplitStrip from './RccpSplitStrip';

const captured = vi.hoisted(() => ({ chartHeight: null, chart: null }));

vi.mock('../../hooks/useRccpSplitAnalysis', () => ({
  useRccpSplitAnalysis: () => ({
    analysis: { config: { itemPickerColumnKeys: ['productName'] }, chart: [], cells: [] },
    loading: false,
    error: '',
    measureRows: [{ measureKey: 'open', isOpen: true }],
    periods: [{ year: 2026, week: 1, key: '2026-W01' }],
    cellMap: new Map(),
    chart: [{
      year: 2026,
      week: 1,
      key: '2026-W01',
      segmentsAbove: [
        { itemNumber: 'ITEM-A', poNumber: 'PO-A', qty: 2, status: 'open' },
        { itemNumber: 'ITEM-B', poNumber: 'PO-B', qty: 3, status: 'open' },
      ],
      segmentsBelow: [],
    }],
    chartWeekRanges: [],
  }),
}));

vi.mock('./RccpChartMatrixPanel', () => ({
  default: (props) => {
    captured.chartHeight = props.chartHeight;
    captured.chart = props.chart;
    return <div>chart-matrix</div>;
  },
}));

describe('RccpSplitStrip', () => {
  it('renders the PO-board RCCP pane without an item picker', () => {
    const { container, queryByRole } = renderWithFluent(
      <MemoryRouter>
        <RccpSplitStrip
          vendorAccount="V000583"
          refreshKey="1"
          enabled
          isoWindow={{ fromYear: 2026, fromWeek: 1, toYear: 2026, toWeek: 12 }}
        />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain('chart-matrix');
    expect(container.textContent).not.toContain('Open PERF page');
    expect(container.textContent).not.toContain('Vendor: V000583');
    expect(container.textContent).not.toContain('item-filter');
    expect(queryByRole('tab', { name: 'Week' })).toBeNull();
    expect(queryByRole('tab', { name: 'Requested' })).toBeNull();
    expect(captured.chart[0].segmentsAbove).toHaveLength(2);
  });

  it('keeps a fixed chart height when the split pane is resized', () => {
    const { rerender } = renderWithFluent(
      <MemoryRouter>
        <RccpSplitStrip
          vendorAccount="V000583"
          refreshKey="1"
          enabled
          isoWindow={{ fromYear: 2026, fromWeek: 1, toYear: 2026, toWeek: 12 }}
        />
      </MemoryRouter>,
    );
    const first = captured.chartHeight;
    rerender(
      <MemoryRouter>
        <RccpSplitStrip
          vendorAccount="V000583"
          refreshKey="1"
          enabled
          isoWindow={{ fromYear: 2026, fromWeek: 1, toYear: 2026, toWeek: 12 }}
        />
      </MemoryRouter>,
    );
    expect(captured.chartHeight).toBe(first);
    expect(captured.chartHeight).toBeGreaterThan(0);
  });

  it('filters chart stacks to visible PO order numbers', () => {
    renderWithFluent(
      <MemoryRouter>
        <RccpSplitStrip
          vendorAccount="V000583"
          refreshKey="1"
          enabled
          isoWindow={{ fromYear: 2026, fromWeek: 1, toYear: 2026, toWeek: 12 }}
          orderNumbers={['PO-A']}
        />
      </MemoryRouter>,
    );
    expect(captured.chart[0].segmentsAbove).toEqual([
      { itemNumber: 'ITEM-A', poNumber: 'PO-A', qty: 2, status: 'open' },
    ]);
  });
});
