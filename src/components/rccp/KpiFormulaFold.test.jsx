// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithFluent } from '../../test-utils/render';
import KpiFormulaFold from './KpiFormulaFold';

describe('KpiFormulaFold', () => {
  it('renders nothing without a formula', () => {
    const { container } = renderWithFluent(<KpiFormulaFold formula="" kpiKey="ordered" />);
    expect(container.querySelector('[data-kpi-formula-trigger]')).toBeNull();
  });

  it('shows a folded-corner trigger and opens the formula on click', () => {
    const onParentClick = vi.fn();
    renderWithFluent(
      <div onClick={onParentClick}>
        <KpiFormulaFold formula={'open + delivered\non visible lines'} kpiKey="ordered" />
      </div>,
    );
    const trigger = screen.getByRole('button', { name: 'View formula' });
    expect(trigger.getAttribute('data-kpi-formula-trigger')).toBe('true');
    fireEvent.click(trigger);
    expect(screen.getByText('Formula')).toBeTruthy();
    expect(screen.getByText(/open \+ delivered/)).toBeTruthy();
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('shows color settings on percentage KPI cards for an employee', () => {
    renderWithFluent(
      <KpiFormulaFold formula="delivered / ordered × 100" kpiKey="delivered" />,
      { authUser: { role: 'employee' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Card settings' }));
    expect(screen.getByLabelText('Which value gets the color')).toBeTruthy();
    expect(screen.getByText('This value')).toBeTruthy();
    expect(screen.getByText('Other value')).toBeTruthy();
    expect(screen.getByText('Formula')).toBeTruthy();
  });

  it('shows color settings on percentage KPI cards for an admin', () => {
    renderWithFluent(
      <KpiFormulaFold formula="delivered / ordered × 100" kpiKey="delivered" />,
      { authUser: { role: 'admin' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Card settings' }));
    expect(screen.getByLabelText('Which value gets the color')).toBeTruthy();
  });

  it('hides color settings for a supplier (vendor) and only shows the formula', () => {
    renderWithFluent(
      <KpiFormulaFold formula="delivered / ordered × 100" kpiKey="delivered" />,
      { authUser: { role: 'supplier' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'View formula' }));
    expect(screen.queryByLabelText('Which value gets the color')).toBeNull();
    expect(screen.queryByLabelText('KPI card color')).toBeNull();
    expect(screen.getByText('Formula')).toBeTruthy();
  });

  it('keeps the fold graphic hidden until hover', () => {
    const { container } = renderWithFluent(
      <KpiFormulaFold formula="open + delivered" kpiKey="ordered" />,
    );
    const divider = container.querySelector('[data-fold-divider]');
    expect(divider).toBeTruthy();
    expect(getComputedStyle(divider).opacity).toBe('0');
  });
});
