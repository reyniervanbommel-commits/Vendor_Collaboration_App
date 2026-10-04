import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import PurchaseOrderViewTabHoverCard from './PurchaseOrderViewTabHoverCard';

describe('PurchaseOrderViewTabHoverCard', () => {
  it('toont extra filters op een kaart met achtergrond', () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <PurchaseOrderViewTabHoverCard
          tab={{
            id: 'tab_1',
            name: 'Open orders',
            extraFilters: { status: { operator: 'equals', value: 'Open' } },
          }}
          columns={[{ key: 'status', label: 'Status', dataType: 'text' }]}
          anchorRect={{ left: 20, top: 80 }}
        />
      </FluentProvider>
    );

    const card = screen.getByRole('tooltip');
    expect(card).toBeTruthy();
    expect(getComputedStyle(card).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(card).backgroundColor).not.toBe('transparent');
    expect(screen.getByText('Open orders')).toBeTruthy();
    expect(screen.getByText('Status:')).toBeTruthy();
    expect(screen.getByText('is exactly Open')).toBeTruthy();
  });

  it('toont view-base filters op een kolom-tab', () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <PurchaseOrderViewTabHoverCard
          tab={{
            id: 'tab_1',
            name: 'Marisport',
            extraFilters: { vendorName: { operator: 'equals', value: 'Marisport' } },
          }}
          columns={[
            { key: 'itemValues', label: 'Artikel values', dataType: 'text' },
            { key: 'vendorName', label: 'Leveranciersnaam', dataType: 'text' },
          ]}
          viewBaseFilters={{ itemValues: { operator: 'contains', value: 's' } }}
          anchorRect={{ left: 20, top: 80 }}
        />
      </FluentProvider>
    );
    expect(screen.getByText('Artikel values:')).toBeTruthy();
    expect(screen.getByText('contains s')).toBeTruthy();
    expect(screen.getByText('Leveranciersnaam:')).toBeTruthy();
  });

  it('toont view-filters-only voor de All-tab', () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <PurchaseOrderViewTabHoverCard
          tab={{ id: 'all', name: 'All', extraFilters: {} }}
          columns={[]}
          anchorRect={{ left: 20, top: 80 }}
        />
      </FluentProvider>
    );
    expect(screen.getByText('View filters only')).toBeTruthy();
  });
});
