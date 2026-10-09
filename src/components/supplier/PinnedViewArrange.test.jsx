import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, Menu, MenuList, MenuPopover, MenuTrigger, webLightTheme } from '@fluentui/react-components';
import PurchaseOrderPinnedViewTabs from './PurchaseOrderPinnedViewTabs';
import PurchaseOrderViewTabBar from './viewTabs/PurchaseOrderViewTabBar';
import TabReorderDialog from './viewTabs/TabReorderDialog';
import { SavedViewMenuItem } from './PurchaseOrderSavedViewMenuItems';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function wrap(ui) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

const views = [
  { id: 1, name: 'Bravo', scope: 'personal', viewState: { showAsTab: true } },
  { id: 2, name: 'Alpha', scope: 'global', viewState: { showAsTab: true } },
  { id: 3, name: 'Charlie', scope: 'personal', viewState: { showAsTab: true } },
];

function tabNames() {
  return screen.getAllByRole('tab').map((tab) => tab.getAttribute('data-tab-id'));
}

describe('PurchaseOrderPinnedViewTabs ordening', () => {
  it('volgt de eigen volgorde en zet nieuwe pins achteraan', () => {
    wrap(<PurchaseOrderPinnedViewTabs views={views} activeViewId={null} onApplyView={vi.fn()} order={['3', '1']} onReorder={vi.fn()} />);
    expect(tabNames()).toEqual(['3', '1', '2']);
  });

  it('sorteert via het rechtermuisknopmenu, zonder Move left/right', async () => {
    const onReorder = vi.fn();
    wrap(<PurchaseOrderPinnedViewTabs views={views} activeViewId={null} onApplyView={vi.fn()} onReorder={onReorder} />);
    fireEvent.contextMenu(screen.getAllByRole('tab')[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Sort Z to A/ }));
    expect(onReorder).toHaveBeenLastCalledWith(['3', '1', '2']);
    expect(screen.queryByRole('menuitem', { name: /Move (left|right)/ })).toBeNull();
  });

  it('toont Unpin alleen als de gebruiker de view mag wijzigen', async () => {
    const onUnpin = vi.fn();
    wrap(
      <PurchaseOrderPinnedViewTabs
        views={views}
        activeViewId={null}
        onApplyView={vi.fn()}
        onReorder={vi.fn()}
        canUnpin={(view) => view.scope === 'personal'}
        onUnpin={onUnpin}
      />
    );
    fireEvent.contextMenu(screen.getAllByRole('tab')[1]);
    await screen.findByRole('menuitem', { name: /Reorder tabs/ });
    expect(screen.queryByRole('menuitem', { name: 'Unpin' })).toBeNull();
  });
});

describe('PurchaseOrderViewTabBar ordening', () => {
  it('sorteert binnen de kolomgroep via het rechtermuisknopmenu', async () => {
    const onReorderTabs = vi.fn();
    const extraTabs = [
      { id: 't1', name: 'Week 10', groupColumnKey: 'week', extraFilters: {} },
      { id: 't2', name: 'Week 2', groupColumnKey: 'week', extraFilters: {} },
    ];
    wrap(
      <PurchaseOrderViewTabBar
        activeTabId="all"
        extraTabs={extraTabs}
        groups={[{ columnKey: 'week', color: '#00c875' }]}
        canManage
        onSelectTab={vi.fn()}
        onRemoveTab={vi.fn()}
        onSetGroupColor={vi.fn()}
        onReorderTabs={onReorderTabs}
      />
    );
    fireEvent.contextMenu(screen.getByRole('tab', { name: /Week 10/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Sort A to Z/ }));
    expect(onReorderTabs).toHaveBeenCalledWith(['t2', 't1']);
  });
});

describe('TabReorderDialog', () => {
  it('past de volgorde pas toe bij Apply', () => {
    const onApply = vi.fn();
    wrap(
      <TabReorderDialog
        open
        items={[{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Bravo' }]}
        onOpenChange={vi.fn()}
        onApply={onApply}
      />
    );
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Move Alpha down' }));
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith(['b', 'a']);
  });
});

describe('SavedViewMenuItem pin', () => {
  function renderItem(props) {
    return wrap(
      <Menu open>
        <MenuTrigger disableButtonEnhancement><button type="button">open</button></MenuTrigger>
        <MenuPopover>
          <MenuList>
            <SavedViewMenuItem
              activeViewId={null}
              onApplyView={vi.fn()}
              onToggleShowHistory={vi.fn()}
              canManageGlobal={false}
              {...props}
            />
          </MenuList>
        </MenuPopover>
      </Menu>
    );
  }

  it('pint een view zonder de view toe te passen', async () => {
    const onToggleShowAsTab = vi.fn();
    const onApplyView = vi.fn();
    renderItem({ view: views[0] && { ...views[0], viewState: {} }, onToggleShowAsTab, onApplyView });
    const pin = await screen.findByRole('button', { name: 'Pin Bravo as a tab' });
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pin);
    await waitFor(() => expect(onToggleShowAsTab).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), true));
    expect(onApplyView).not.toHaveBeenCalled();
  });

  it('blokkeert pinnen van gedeelde views voor niet-staff', async () => {
    const onToggleShowAsTab = vi.fn();
    renderItem({ view: views[1], onToggleShowAsTab });
    const pin = await screen.findByRole('button', { name: 'Unpin Alpha' });
    expect(pin.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(pin);
    expect(onToggleShowAsTab).not.toHaveBeenCalled();
  });
});
