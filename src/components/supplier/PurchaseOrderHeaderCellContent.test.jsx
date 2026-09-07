import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import PurchaseOrderHeaderCellContent from './PurchaseOrderHeaderCellContent';
import { createProductImageColumn } from '../../utils/purchaseOrderProductImageColumn';

function renderHeaderCell(props) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <PurchaseOrderHeaderCellContent {...props} />
    </FluentProvider>
  );
}

describe('PurchaseOrderHeaderCellContent', () => {
  // De samenvatting komt sinds de lazy-lines-payload als rollup uit de board-read;
  // de cel berekent zelf niets meer over de sublijnen.
  it('renders the product image column from the rollup summary', async () => {
    renderHeaderCell({
      order: {
        dataAreaId: 'nl01',
        orderNumber: 'PO-1',
        values: { status: 'Open' },
      },
      column: createProductImageColumn('header'),
      productImageSummary: { firstItemNumber: 'VISIBLE-ITEM', additionalItemCount: 0 },
    });

    // The <img> only mounts after the load-settle delay (debounced against fast scrolling).
    expect(await screen.findByAltText('Product image for VISIBLE-ITEM')).toBeTruthy();
    expect(screen.queryByAltText('Product image for HIDDEN-ITEM')).toBeNull();
  });

  // Zelfde "+N"-badgepatroon als de productafbeelding, maar dan voor elke kolom die via
  // "Push values to header column" naar de header is gekoppeld.
  it('renders the first linked value with a "+N" badge when there are more unique values', () => {
    renderHeaderCell({
      order: {
        dataAreaId: 'nl01',
        orderNumber: 'PO-1',
        values: { colorValues: 'Red, Blue, Green' },
        linkedLineValues: { colorValues: ['Red', 'Blue', 'Green'] },
      },
      column: { key: 'colorValues', label: 'Color Values', dataType: 'text', source: 'custom' },
      linkedLineValueMap: { colorValues: { lineColumnKey: 'color', lineDataType: 'text' } },
    });

    expect(screen.getByText('Red')).toBeTruthy();
    expect(screen.getByLabelText('2 additional unique values')).toBeTruthy();
  });

  it('renders the linked value without a badge when there is only one unique value', () => {
    renderHeaderCell({
      order: {
        dataAreaId: 'nl01',
        orderNumber: 'PO-1',
        values: { colorValues: 'Red' },
        linkedLineValues: { colorValues: ['Red', 'Red'] },
      },
      column: { key: 'colorValues', label: 'Color Values', dataType: 'text', source: 'custom' },
      linkedLineValueMap: { colorValues: { lineColumnKey: 'color', lineDataType: 'text' } },
    });

    expect(screen.getByText('Red')).toBeTruthy();
    expect(screen.queryByLabelText(/additional unique values/)).toBeNull();
  });

  it('formats pushed receipt dates as dd/mm/yyyy instead of ISO datetime', () => {
    renderHeaderCell({
      order: {
        dataAreaId: 'nl01',
        orderNumber: 'PO-1',
        values: { receiptDateValues: '2026-08-25T00:00:00.000Z' },
        linkedLineValues: { receiptDateValues: ['2026-08-25T00:00:00.000Z'] },
      },
      column: {
        key: 'receiptDateValues',
        label: 'Receipt date Values',
        dataType: 'text',
        source: 'custom',
      },
      linkedLineValueMap: {
        receiptDateValues: { lineColumnKey: 'receiptDate', lineDataType: 'text' },
      },
    });

    expect(screen.getByText('25/08/2026')).toBeTruthy();
    expect(screen.queryByDisplayValue(/2026-08-25/)).toBeNull();
  });

  it('formats ISO dates on a pushed header column even without a linked-value map', () => {
    renderHeaderCell({
      order: {
        dataAreaId: 'nl01',
        orderNumber: 'PO-1',
        values: { receiptDateValues: '2026-08-25T00:00:00.000Z' },
      },
      column: {
        key: 'receiptDateValues',
        label: 'Receipt date Values',
        dataType: 'text',
        source: 'custom',
      },
    });

    expect(screen.getByText('25/08/2026')).toBeTruthy();
    expect(screen.queryByDisplayValue(/2026-08-25T00:00:00/)).toBeNull();
  });

  // Meerdere gepushte regel-datums: eerste datum + "+N"-badge, zelfde patroon als de
  // "+N"-badge op de Image-kolom, ook zonder linkedLineValueMap-koppeling.
  it('shows the first pushed date with a "+N" badge when multiple unique dates are pushed', () => {
    renderHeaderCell({
      order: {
        dataAreaId: 'nl01',
        orderNumber: 'PO-1',
        values: { receiptDateValues: '2026-05-07T00:00:00.000Z, 2026-04-21T00:00:00.000Z' },
      },
      column: {
        key: 'receiptDateValues',
        label: 'Receipt date Values',
        dataType: 'text',
        source: 'custom',
      },
    });

    expect(screen.getByText('07/05/2026')).toBeTruthy();
    expect(screen.getByLabelText('1 additional unique values')).toBeTruthy();
  });

  it('renders a write-back input when the pushed line column is writable', () => {
    renderHeaderCell({
      order: {
        dataAreaId: 'nl01',
        orderNumber: 'PO-1',
        linkedLineValues: { colorValues: ['Red'] },
      },
      column: { key: 'colorValues', label: 'Color Values', dataType: 'text', source: 'custom' },
      linkedLineValueMap: {
        colorValues: {
          lineColumnKey: 'color',
          lineColumnId: 44,
          lineDataType: 'text',
          lineColumnLabel: 'Color',
          writableToD365: true,
          lineColumn: {
            id: 44,
            key: 'color',
            label: 'Color',
            dataType: 'text',
            writableToD365: true,
            d365Field: 'Color',
          },
        },
      },
      actions: { onCorrectAllLines: () => {} },
    });

    expect(screen.getByLabelText(/write back to D365 on all lines/)).toBeTruthy();
  });

  it('keeps a custom date column editable instead of rendering it as read-only text', () => {
    renderHeaderCell({
      order: {
        dataAreaId: 'nl01',
        orderNumber: 'PO-1',
        values: { myDate: '2026-08-25T00:00:00.000Z' },
      },
      column: { key: 'myDate', label: 'My date', dataType: 'date', source: 'custom' },
    });

    expect(screen.getByDisplayValue('2026-08-25')).toBeTruthy();
  });
});
