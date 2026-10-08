import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import PurchaseOrdersActiveRulesFlyout from './PurchaseOrdersActiveRulesFlyout';

vi.mock('./PurchaseOrdersActiveFormatEditor', () => ({
  default: ({ item, referenceColumns = [], onSetColumnFormatRules }) => (
    <div data-testid={`format-editor-${item.scope}`}>
      <span>{referenceColumns.map((column) => column.key).join(',')}</span>
      <button
        type="button"
        onClick={() => onSetColumnFormatRules?.(item.columnKey, { target: 'cell', rules: [] })}
      >
        Save {item.scope}
      </button>
    </div>
  ),
}));

const emptyRules = { header: [], line: [] };

function renderFlyout(overrides = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    filters: emptyRules,
    formatRules: emptyRules,
    onClearFilter: vi.fn(),
    onClearFormatRules: vi.fn(),
    ...overrides,
  };

  render(
    <FluentProvider theme={webLightTheme}>
      <PurchaseOrdersActiveRulesFlyout {...props} />
    </FluentProvider>
  );

  return props;
}

describe('PurchaseOrdersActiveRulesFlyout', () => {
  it('shows empty text for filters and conditional formatting', () => {
    renderFlyout();

    expect(screen.getByText('No active filters')).toBeTruthy();
    expect(screen.getByText('No conditional formatting')).toBeTruthy();
  });

  it('shows a header filter and clears it', () => {
    const filterItem = {
      id: 'header:vendor',
      columnKey: 'vendor',
      columnLabel: 'Vendor',
      scope: 'header',
      column: { key: 'vendor', label: 'Vendor' },
      summary: 'contains Acme',
      filter: { operator: 'contains', value: 'Acme' },
    };
    const onClearFilter = vi.fn();

    renderFlyout({
      filters: { header: [filterItem], line: [] },
      onClearFilter,
    });

    expect(screen.getByText('Vendor')).toBeTruthy();
    expect(screen.getByText('contains Acme')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onClearFilter).toHaveBeenCalledWith(filterItem);
  });

  it('mounts the header format editor after expanding a header rule', () => {
    const headerRule = {
      id: 'header:status',
      columnKey: 'status',
      columnLabel: 'Status',
      scope: 'header',
      column: { key: 'status', label: 'Status' },
      summary: '1 rule',
      ruleSet: { target: 'row', rules: [{ op: '=', value: 'Open' }] },
    };
    const onSaveHeaderColumnFormatRules = vi.fn();

    renderFlyout({
      formatRules: { header: [headerRule], line: [] },
      formatEditorProps: {
        headerColumns: [{ key: 'status' }, { key: 'vendor' }],
        lineColumns: [{ key: 'qty' }],
        onSaveHeaderColumnFormatRules,
        onSaveLineColumnFormatRules: vi.fn(),
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Expand Status' }));

    expect(screen.getByTestId('format-editor-header').textContent).toContain('status,vendor');
    fireEvent.click(screen.getByRole('button', { name: 'Save header' }));
    expect(onSaveHeaderColumnFormatRules).toHaveBeenCalledWith('status', { target: 'cell', rules: [] });
  });

  it('routes line format editor saves and clear actions to line callbacks', () => {
    const lineRule = {
      id: 'line:qty',
      columnKey: 'qty',
      columnLabel: 'Qty',
      scope: 'line',
      column: { key: 'qty', label: 'Qty' },
      summary: '1 rule',
      ruleSet: { target: 'cell', rules: [{ op: '>', value: '10' }] },
    };
    const onClearFormatRules = vi.fn();
    const onSaveLineColumnFormatRules = vi.fn();

    renderFlyout({
      formatRules: { header: [], line: [lineRule] },
      onClearFormatRules,
      formatEditorProps: {
        headerColumns: [{ key: 'status' }],
        lineColumns: [{ key: 'qty' }, { key: 'itemId' }],
        onSaveHeaderColumnFormatRules: vi.fn(),
        onSaveLineColumnFormatRules,
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Expand Qty' }));

    expect(screen.getByTestId('format-editor-line').textContent).toContain('qty,itemId');
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }));
    expect(onSaveLineColumnFormatRules).toHaveBeenCalledWith('qty', { target: 'cell', rules: [] });

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClearFormatRules).toHaveBeenCalledWith(lineRule);
  });

  it('toont filters als kaarten in een lijst met operator en waarde op een eigen regel', () => {
    const filterItem = {
      id: 'header:artikel',
      columnKey: 'artikel',
      columnLabel: 'Artikel Values',
      scope: 'header',
      column: { key: 'artikel', label: 'Artikel Values' },
      summary: 'contains M-10300-02',
      summaryParts: [{ type: 'operator', text: 'contains' }, { type: 'value', text: 'M-10300-02' }],
      filter: { operator: 'contains', value: 'M-10300-02' },
    };
    renderFlyout({ filters: { header: [filterItem], line: [] } });
    expect(document.querySelector('table')).toBeNull();
    const list = screen.getByRole('list', { name: 'Header columns' });
    const card = list.querySelector('li');
    expect(card.textContent).toContain('Artikel Values');
    const summary = card.querySelector('[data-rule-summary]');
    expect(summary.textContent).toBe('contains M-10300-02');
    expect(summary.contains(screen.getByRole('button', { name: 'Clear' }))).toBe(false);
  });
});
