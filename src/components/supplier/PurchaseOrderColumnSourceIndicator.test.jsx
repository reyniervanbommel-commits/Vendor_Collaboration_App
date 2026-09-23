import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import PurchaseOrderColumnSourceIndicator from './PurchaseOrderColumnSourceIndicator';

function renderIndicator(props) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <PurchaseOrderColumnSourceIndicator
        sourceMeta={{ key: 'purchase-orders', label: 'Purchase orders · Amount' }}
        {...props}
      />
    </FluentProvider>
  );
}

describe('PurchaseOrderColumnSourceIndicator', () => {
  it('toont alleen het bron-icoon zonder koppeling', () => {
    renderIndicator();
    expect(screen.getByTestId('column-source-icon')).toBeTruthy();
    expect(screen.queryByTestId('column-connection-icon')).toBeNull();
    expect(screen.getByTestId('column-source-cluster').getAttribute('data-tooltip')).toBe('Purchase orders · Amount');
  });

  it('toont bron en ketting naast elkaar zonder klikbaar paneel', () => {
    renderIndicator({
      columnLevel: 'header',
      connectionTargets: ['Subitem column "Qty" (values)'],
    });
    expect(screen.getByTestId('column-source-icon')).toBeTruthy();
    expect(screen.getByTestId('column-source-cluster').getAttribute('data-tooltip')).toBe(
      'Purchase orders · Amount\nConnected to line column "Qty"'
    );
    expect(screen.getByTestId('column-connection-icon').tagName).not.toBe('BUTTON');
    fireEvent.click(screen.getByTestId('column-connection-icon'));
    expect(screen.queryByText(/Subitem column/i)).toBeNull();
  });

  it('toont ketting met date W/M-bron in de tooltip', () => {
    renderIndicator({
      connectionTargets: ['Date column "Requested delivery date"'],
    });
    expect(screen.getByTestId('column-connection-icon')).toBeTruthy();
    expect(screen.getByTestId('column-source-cluster').getAttribute('data-tooltip')).toBe(
      'Purchase orders · Amount\nConnected to date column "Requested delivery date"'
    );
  });
});
