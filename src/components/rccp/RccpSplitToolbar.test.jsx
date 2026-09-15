// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithFluent } from '../../test-utils/render';
import RccpSplitToolbar from './RccpSplitToolbar';

const isoWindow = {
  fromYear: 2026,
  fromWeek: 10,
  toYear: 2026,
  toWeek: 16,
};

describe('RccpSplitToolbar', () => {
  it('shows compact week picker and toggle buttons for grain and load date', () => {
    const { getByRole } = renderWithFluent(
      <MemoryRouter>
        <RccpSplitToolbar
          isoWindow={isoWindow}
          onReplaceWindow={vi.fn()}
          periodGrain="week"
          onPeriodGrainChange={vi.fn()}
          planningDateModes="requested"
          onPlanningDateModesChange={vi.fn()}
          vendorAccount="V000356"
        />
      </MemoryRouter>,
    );
    expect(getByRole('button', { name: /Period / })).toBeTruthy();
    expect(getByRole('radio', { name: 'Week' })).toBeTruthy();
    expect(getByRole('radio', { name: 'Month' })).toBeTruthy();
    expect(getByRole('checkbox', { name: 'Requested' })).toBeTruthy();
    expect(getByRole('checkbox', { name: 'Confirmed' })).toBeTruthy();
    expect(getByRole('button', { name: 'Open PERF page' })).toBeTruthy();
    expect(getByRole('group', { name: 'RCCP controls' }).textContent).toContain('Vendor: V000356');
  });

  it('enables Show weeks with data when the filtered vendor has load', () => {
    const { getByRole } = renderWithFluent(
      <MemoryRouter>
        <RccpSplitToolbar
          isoWindow={isoWindow}
          onReplaceWindow={vi.fn()}
          periodGrain="week"
          onPeriodGrainChange={vi.fn()}
          planningDateModes="requested"
          onPlanningDateModesChange={vi.fn()}
          vendorAccount="V000356"
          analysis={{ dataWindow: { fromYear: 2021, fromWeek: 47, toYear: 2022, toWeek: 51 } }}
          onShowDataWindow={vi.fn()}
        />
      </MemoryRouter>,
    );
    fireEvent.click(getByRole('button', { name: /Period / }));
    expect(getByRole('button', { name: 'Show weeks with data' })).not.toBeDisabled();
  });
});
