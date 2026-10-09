import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FluentProvider, Menu, MenuList, MenuPopover, MenuTrigger, webLightTheme } from '@fluentui/react-components';
import PurchaseOrderSavedViewTitleTrigger from './PurchaseOrderSavedViewTitleTrigger';
import PurchaseOrderPinnedViewTabs from './PurchaseOrderPinnedViewTabs';
import SavedViewHistoryToggle from './SavedViewHistoryToggle';
import { SavedViewScopeGroup } from './PurchaseOrderSavedViewMenuItems';

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

describe('SavedViewHistoryToggle', () => {
  it('zet history uit bij klikken als die aan staat', () => {
    const onChange = vi.fn();
    wrap(<SavedViewHistoryToggle checked onChange={onChange} />);
    const toggle = screen.getByRole('button', { name: 'Hide history' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(onChange.mock.calls[0][1].checked).toBe(false);
  });

  it('zet history aan bij klikken als die uit staat', () => {
    const onChange = vi.fn();
    wrap(<SavedViewHistoryToggle checked={false} onChange={onChange} />);
    const toggle = screen.getByRole('button', { name: 'Show history' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(onChange.mock.calls[0][1].checked).toBe(true);
  });
});

describe('SavedViewMenuItem default star', () => {
  const views = [
    { id: 1, name: 'First', scope: 'personal', viewState: {} },
    { id: 2, name: 'Second', scope: 'personal', viewState: {} },
  ];

  function renderMenu({ defaultViewId, onToggleDefault = vi.fn(), onApplyView = vi.fn() }) {
    wrap(
      <Menu open>
        <MenuTrigger disableButtonEnhancement><button type="button">open</button></MenuTrigger>
        <MenuPopover>
          <MenuList>
            <SavedViewScopeGroup
              views={views}
              activeViewId={null}
              onApplyView={onApplyView}
              onToggleShowHistory={vi.fn()}
              onToggleShowAsTab={vi.fn()}
              defaultViewId={defaultViewId}
              onToggleDefault={onToggleDefault}
              canManageGlobal
            />
          </MenuList>
        </MenuPopover>
      </Menu>
    );
    return { onToggleDefault, onApplyView };
  }

  it('toont precies één blauwe ster voor de default view', () => {
    renderMenu({ defaultViewId: 2 });
    expect(screen.getByRole('button', { name: 'Second is your default view' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Make First your default view' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('maakt een view default bij klikken zonder de view te openen', () => {
    const { onToggleDefault, onApplyView } = renderMenu({ defaultViewId: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Make First your default view' }));
    expect(onToggleDefault).toHaveBeenCalledWith(views[0]);
    expect(onApplyView).not.toHaveBeenCalled();
  });
});
