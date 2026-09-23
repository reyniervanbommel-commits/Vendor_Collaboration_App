// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderWithFluent } from '../../test-utils/render';
import KpiCard from './RccpKpiCard';

describe('KpiCard badge + progress bar', () => {
  it('shows a % badge and progress bar only when a percentage is present', () => {
    const withPct = renderWithFluent(
      <KpiCard kpiKey="delivered" label="Total delivered" qty={26084} hash pct="99.5%" />,
    );
    expect(withPct.container.querySelector('[data-kpi-pct-badge]')).toBeTruthy();
    expect(withPct.container.querySelector('[data-kpi-pct-bar]')).toBeTruthy();

    const withoutPct = renderWithFluent(
      <KpiCard kpiKey="ordered" label="Total ordered" qty={26200} hash />,
    );
    expect(withoutPct.container.querySelector('[data-kpi-pct-badge]')).toBeNull();
    expect(withoutPct.container.querySelector('[data-kpi-pct-bar]')).toBeNull();
  });

  it('fills the progress bar to the percentage value', () => {
    const { container } = renderWithFluent(
      <KpiCard kpiKey="open" label="Total open" qty={50} hash pct="73.5%" />,
    );
    const fill = container.querySelector('[data-kpi-pct-bar] > div');
    expect(fill.style.width).toBe('73.5%');
  });

  it('renders the badge text as the formatted percentage', () => {
    const { getByText } = renderWithFluent(
      <KpiCard kpiKey="unconfirmed" label="Not confirmed" qty={12} hash pct="40.0%" />,
    );
    expect(getByText('40.0%')).toBeTruthy();
  });
});

describe('KpiCard compact value', () => {
  it('shows the full quantity on compact tiles', () => {
    const { getByText, queryByText } = renderWithFluent(
      <KpiCard compact kpiKey="open" label="Total open" qty={333230} hash pct="96.6%" />,
    );
    expect(getByText('333,230')).toBeTruthy();
    expect(queryByText('333.2K')).toBeNull();
    expect(getByText('96.6%')).toBeTruthy();
  });

  it('hides the days-late detail on compact tiles', () => {
    const { getByText, queryByText } = renderWithFluent(
      <KpiCard
        compact
        kpiKey="openLate"
        label="Open and late"
        qty={328205}
        hash
        aside="1,431 items"
        detail="Ø 222 days late"
      />,
    );
    expect(getByText('328,205')).toBeTruthy();
    expect(getByText('1,431 items')).toBeTruthy();
    expect(queryByText('Ø 222 days late')).toBeNull();
  });
});

describe('KpiCard full-size layout', () => {
  it('renders a two-line title slot', () => {
    const { container, getByText } = renderWithFluent(
      <KpiCard kpiKey="onTime" label="On time delivery" qty={4687} hash pct="1.4%" />,
    );
    expect(container.querySelector('[data-kpi-label]')).toBeTruthy();
    expect(getByText('On time delivery')).toBeTruthy();
  });

  it('shows the full quantity and the badge', () => {
    const { getByText } = renderWithFluent(
      <KpiCard kpiKey="delivered" label="Total delivered" qty={11635} hash pct="3.4%" />,
    );
    expect(getByText('11,635')).toBeTruthy();
    expect(getByText('3.4%')).toBeTruthy();
  });

  it('places the % badge on the items row', () => {
    const { container } = renderWithFluent(
      <KpiCard kpiKey="open" label="Total open" qty={50} hash aside="1,432 items" pct="96.6%" />,
    );
    const badge = container.querySelector('[data-kpi-pct-badge]');
    expect(badge?.parentElement?.textContent).toContain('1,432 items');
    expect(badge?.parentElement?.textContent).toContain('96.6%');
  });

  it('keeps the days-late detail on full-size cards', () => {
    const { getByText } = renderWithFluent(
      <KpiCard
        kpiKey="openLate"
        label="Open and late"
        qty={328205}
        hash
        aside="1,431 items"
        detail="Ø 222 days late"
      />,
    );
    expect(getByText('328,205')).toBeTruthy();
    expect(getByText('Ø 222 days late')).toBeTruthy();
  });
});
