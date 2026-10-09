// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { describe, expect, it, vi } from 'vitest';
import PurchaseOrderWriteBackCell from './PurchaseOrderWriteBackCell';

function renderCell(props) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <PurchaseOrderWriteBackCell
        column={{ key: 'color', label: 'Color', dataType: 'text' }}
        value="Red"
        {...props}
      />
    </FluentProvider>
  );
}

describe('PurchaseOrderWriteBackCell', () => {
  it('does not clip the history fold when a cell has history', () => {
    renderCell({
      hasHistory: true,
      cellKeys: { columnId: 1, dataAreaId: 'whsl', orderNumber: 'PO-1', lineNumber: null },
    });
    const trigger = screen.getByRole('button', { name: 'View cell history' });
    const cell = trigger.closest('span');
    expect(cell).toBeTruthy();
    expect(window.getComputedStyle(cell).overflow).toBe('visible');
  });

  it('uses remainingDisplayValue on reject instead of the pre-edit value', async () => {
    const onCorrect = vi.fn().mockRejectedValue(
      Object.assign(new Error('Write-back failed on 1 of 2 lines.'), {
        remainingDisplayValue: 'Blue',
      }),
    );
    renderCell({ onCorrect });
    const input = screen.getByLabelText('Color (write back to D365)');
    fireEvent.change(input, { target: { value: 'Green' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(input.value).toBe('Blue');
    });
    expect(onCorrect).toHaveBeenCalled();
  });
  it('herstelt de oude waarde zonder fout als de bevestiging geannuleerd wordt', async () => {
    const onCorrect = vi.fn().mockResolvedValue({ cancelled: true });
    renderCell({ onCorrect });
    const input = screen.getByLabelText('Color (write back to D365)');
    fireEvent.change(input, { target: { value: 'Green' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(input.value).toBe('Red');
    });
    expect(onCorrect).toHaveBeenCalled();
    expect(screen.queryByText(/failed/i)).toBeNull();
  });
  it('voorkomt de default Enter-actie zodat een bevestigingsdialoog niet direct sluit', async () => {
    const onCorrect = vi.fn().mockResolvedValue({});
    renderCell({ onCorrect });
    const input = screen.getByLabelText('Color (write back to D365)');
    fireEvent.change(input, { target: { value: 'Green' } });
    input.focus();
    const notPrevented = fireEvent.keyDown(input, { key: 'Enter' });
    expect(notPrevented).toBe(false);
    await waitFor(() => {
      expect(onCorrect).toHaveBeenCalled();
    });
  });
});
