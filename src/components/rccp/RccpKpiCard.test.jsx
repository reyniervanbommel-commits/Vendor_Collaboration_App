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
