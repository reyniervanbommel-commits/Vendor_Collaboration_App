import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import PurchaseOrderColumnFilterMenuColumnActionsSection from './PurchaseOrderColumnFilterMenuColumnActionsSection';
import ViewTabsDialogsProvider from './viewTabs/ViewTabsDialogsProvider';

const styles = new Proxy({}, { get: () => 'cls' });

describe('PurchaseOrderColumnFilterMenuColumnActionsSection', () => {
  it('toont geen D365 sync-toggle meer (write-back is alleen instelbaar via Admin > Data model)', () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <ViewTabsDialogsProvider
          viewTabs={{ addTabsFromColumn: vi.fn(), groups: [], uniqueValueCount: () => 1 }}
          columns={[{ key: 'amount', label: 'Amount' }]}
          isStaff
          activeViewId={9}
        >
          <PurchaseOrderColumnFilterMenuColumnActionsSection
            styles={styles}
            closeSubmenu={vi.fn()}
            activeSubmenu=""
            openSubmenu={vi.fn()}
            showColumnSection
            canHideColumn
            handleHideColumn={vi.fn()}
            canCreateFromColumn
            columnKey="amount"
          />
        </ViewTabsDialogsProvider>
      </FluentProvider>
    );

    const labels = screen.getAllByRole('button').map((button) => button.textContent || '');
    const syncIndex = labels.findIndex((label) => /Enable sync|Disable sync/.test(label));
    const hideIndex = labels.findIndex((label) => /Hide column/.test(label));

    expect(syncIndex).toBe(-1);
    expect(hideIndex).toBeGreaterThan(-1);
  });
});
