import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import PurchaseOrderSavedViewTitleTrigger from './PurchaseOrderSavedViewTitleTrigger';
import PurchaseOrderPinnedViewTabs from './PurchaseOrderPinnedViewTabs';
import SavedViewHistoryMiniMenu from './SavedViewHistoryMiniMenu';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function wrap(ui) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

describe('PurchaseOrderSavedViewTitleTrigger', () => {
  it('toont de volledige naam met stip + chevron direct erachter', () => {
    wrap(
      <PurchaseOrderSavedViewTitleTrigger
        name="A very long saved view name that keeps going"
        hasUnsavedChanges
      />
    );
    const button = screen.getByRole('button');
    const name = button.querySelector('span > span');
    expect(name.textContent).toBe('A very long saved view name that keeps going');
    const dot = screen.getByTestId('view-unsaved-dot');
    expect(name.nextElementSibling.contains(dot)).toBe(true);
    expect(dot.nextElementSibling.tagName.toLowerCase()).toBe('svg');
  });

  it('toont geen stip zonder onopgeslagen wijzigingen', () => {
    wrap(<PurchaseOrderSavedViewTitleTrigger name="Open orders" />);
    expect(screen.queryByTestId('view-unsaved-dot')).toBeNull();
  });
});

describe('PurchaseOrderPinnedViewTabs', () => {
  const views = [
    { id: 1, name: 'Pinned one', viewState: { showAsTab: true } },
    { id: 2, name: 'Not pinned', viewState: {} },
    { id: 3, name: 'Pinned two with a long untruncated name', scope: 'vendor', viewState: { showAsTab: true } },
  ];

  it('toont alleen vastgezette views met volledige naam en past een view toe bij klikken', () => {
    const onApplyView = vi.fn();
    wrap(<PurchaseOrderPinnedViewTabs views={views} activeViewId={1} onApplyView={onApplyView} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Pinned one' })).toBe(tabs[0]);
    expect(screen.getByRole('tab', { name: 'Pinned two with a long untruncated name' })).toBe(tabs[1]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tabs[1]);
    expect(onApplyView).toHaveBeenCalledWith(views[2]);
  });

  it('rendert niets zonder vastgezette views', () => {
    const { container } = wrap(
      <PurchaseOrderPinnedViewTabs views={[views[1]]} activeViewId={null} onApplyView={vi.fn()} />
    );
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });
});

describe('SavedViewHistoryMiniMenu', () => {
  it('opent bij hover en schakelt history', async () => {
    const onChange = vi.fn();
    wrap(<SavedViewHistoryMiniMenu checked onChange={onChange} />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: /View options/ }));
    const toggle = await screen.findByRole('switch', { name: 'Show history' });
    fireEvent.click(toggle);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][1].checked).toBe(false);
  });
});
