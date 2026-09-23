import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import PurchaseOrderColumnFilterValuePicker from './PurchaseOrderColumnFilterValuePicker';

function Wrapper(props) {
  return <PurchaseOrderColumnFilterValuePicker columnLabel="Vendor" {...props} />;
}

function renderPicker(props) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <Wrapper {...props} />
    </FluentProvider>
  );
}

describe('PurchaseOrderColumnFilterValuePicker — single mode', () => {
  it('toont de huidige waarde en committeert getypte tekst direct', () => {
    const onChange = vi.fn();
    renderPicker({ mode: 'single', value: '', onChange, uniqueValues: ['Acme', 'Beta'] });
    const input = screen.getByLabelText(/Filter value for Vendor/i);
    fireEvent.change(input, { target: { value: 'Ac' } });
    expect(onChange).toHaveBeenCalledWith('Ac');
  });

  it('toont suggesties die matchen op de getypte tekst en committeert bij klikken', () => {
    const onChange = vi.fn();
    renderPicker({ mode: 'single', value: '', onChange, uniqueValues: ['Acme', 'Beta'] });
    const input = screen.getByLabelText(/Filter value for Vendor/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Ac' } });
    const suggestion = screen.getByRole('option', { name: 'Acme' });
    fireEvent.click(suggestion);
    expect(onChange).toHaveBeenLastCalledWith('Acme');
  });

  it('toont Open order voor Backorder maar committeert de opgeslagen waarde', () => {
    const onChange = vi.fn();
    const formatDisplay = (value) => (value === 'Backorder' ? 'Open order' : String(value));
    renderPicker({
      mode: 'single',
      value: '',
      onChange,
      uniqueValues: ['Backorder', 'Invoiced'],
      formatDisplay,
    });
    const input = screen.getByLabelText(/Filter value for Vendor/i);
    fireEvent.focus(input);
    expect(screen.getByRole('option', { name: 'Open order' })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: 'Open order' }));
    expect(onChange).toHaveBeenLastCalledWith('Backorder');
    expect(screen.getByRole('textbox').value).toBe('Open order');
  });

  it('neemt bij plakken alleen de eerste regel over', () => {
    const onChange = vi.fn();
    renderPicker({ mode: 'single', value: '', onChange, uniqueValues: [] });
    const input = screen.getByLabelText(/Filter value for Vendor/i);
    fireEvent.paste(input, { clipboardData: { getData: () => 'Acme\nBeta\nGamma' } });
    expect(onChange).toHaveBeenCalledWith('Acme');
    expect(screen.getByText(/2 values ignored/i)).toBeTruthy();
  });
});

describe('PurchaseOrderColumnFilterValuePicker — multi mode', () => {
  it('voegt een waarde toe als chip bij Enter en committeert de volledige array', () => {
    const onChange = vi.fn();
    renderPicker({ mode: 'multi', value: ['Acme'], onChange, uniqueValues: [] });
    const input = screen.getByLabelText(/Filter value for Vendor/i);
    fireEvent.change(input, { target: { value: 'Beta' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['Acme', 'Beta']);
  });

  it('plakken van een meerregelige lijst voegt in één keer meerdere chips toe', () => {
    const onChange = vi.fn();
    renderPicker({ mode: 'multi', value: [], onChange, uniqueValues: [] });
    const input = screen.getByLabelText(/Filter value for Vendor/i);
    fireEvent.paste(input, { clipboardData: { getData: () => 'Acme\nBeta\n\nAcme' } });
    expect(onChange).toHaveBeenCalledWith(['Acme', 'Beta']);
  });

  it('verwijdert een chip via de x-knop', () => {
    const onChange = vi.fn();
    renderPicker({ mode: 'multi', value: ['Acme', 'Beta'], onChange, uniqueValues: [] });
    const removeButton = screen.getByRole('button', { name: /Remove Acme/i });
    fireEvent.click(removeButton);
    expect(onChange).toHaveBeenCalledWith(['Beta']);
  });

  it('negeert niet-numerieke geplakte regels voor number-kolommen en meldt het aantal', () => {
    const onChange = vi.fn();
    renderPicker({ mode: 'multi', value: [], onChange, uniqueValues: [], isNumber: true });
    const input = screen.getByLabelText(/Filter value for Vendor/i);
    fireEvent.paste(input, { clipboardData: { getData: () => '9226\nn/a\n9227' } });
    expect(onChange).toHaveBeenCalledWith(['9226', '9227']);
    expect(screen.getByText(/1 value ignored/i)).toBeTruthy();
  });
});

describe('PurchaseOrderColumnFilterValuePicker — single mode inputText sync', () => {
  it('reset inputText wanneer value prop extern leeg wordt', () => {
    const { rerender } = renderPicker({ mode: 'single', value: 'Acme', onChange: vi.fn(), uniqueValues: [] });
    rerender(
      <FluentProvider theme={webLightTheme}>
        <Wrapper mode="single" value="" onChange={vi.fn()} uniqueValues={[]} />
      </FluentProvider>
    );
    const input = screen.getByLabelText(/Filter value for Vendor/i);
    expect(input).toHaveValue('');
  });
});
