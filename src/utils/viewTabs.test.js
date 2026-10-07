import { describe, expect, it } from 'vitest';
import {
  ALL_TAB_ID,
  buildBulkTabs,
  copyGroupExtraFilters,
  existingEqualsValues,
  filterRowsByFilters,
  inferGroupColumnKey,
  mergeFilters,
  nextGroupColor,
  normalizeTabsState,
  preferredSplitColumnKey,
  splitExtraFilters,
  uniqueColumnValues,
  upsertGroup,
  extraFiltersEqual,
  nonGroupExtraFilters,
  tabHasUnsharedExtraFilters,
  viewVendorAccount,
  viewScopeLabel,
  vendorCanSeeView,
  removeTabsByScope,
  formatTabName,
  tabUnderlineColor,
  hasExtraViewTabs,
  tabHoverFilterRows,
  truncateTabLabel,
} from './viewTabs';

describe('viewTabs', () => {
  it('filtert rijen op view-base filters voor unieke tab-waarden', () => {
    const columns = [{ key: 'status', dataType: 'text' }];
    const rows = [
      { values: { status: 'Invoiced', vendorAccount: 'A' } },
      { values: { status: 'Open', vendorAccount: 'B' } },
    ];
    const filtered = filterRowsByFilters(rows, columns, {
      status: { operator: 'equals', value: 'Invoiced', secondaryValue: '' },
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].values.vendorAccount).toBe('A');
  });

  it('neemt unieke niet-lege kolomwaarden uit de huidige rijen', () => {
    const rows = [
      { values: { vendorAccount: 'Q000104' } },
      { values: { vendorAccount: 'Q000104' } },
      { values: { vendorAccount: '  ' } },
      { values: { vendorAccount: 'Q000105' } },
      { values: {} },
    ];
    expect(uniqueColumnValues(rows, 'vendorAccount')).toEqual(['Q000104', 'Q000105']);
  });

  it('bouwt bulk-tabs en slaat bestaande equals-waarden over', () => {
    const existing = [{
      id: 'tab_old',
      name: 'Q000104',
      groupColumnKey: 'vendorAccount',
      extraFilters: { vendorAccount: { operator: 'equals', value: 'Q000104', secondaryValue: '' } },
    }];
    const created = buildBulkTabs({
      columnKey: 'vendorAccount',
      values: ['Q000104', 'Q000105'],
      existingTabs: existing,
    });
    expect(created).toHaveLength(1);
    expect(created[0].name).toBe('Q000105');
    expect(created[0].groupColumnKey).toBe('vendorAccount');
    expect(created[0].extraFilters.vendorAccount.value).toBe('Q000105');
    expect(existingEqualsValues([...existing, ...created], 'vendorAccount').has('q000104')).toBe(true);
  });

  it('kapt tab-labels af tot 10 tekens', () => {
    expect(truncateTabLabel('Open')).toBe('Open');
    expect(truncateTabLabel('Vendor:twtwtwtwt V000123')).toBe('Vendor:twt…');
    expect(formatTabName('  Q000105  ')).toBe('Q000105');
    const created = buildBulkTabs({
      columnKey: 'vendorAccount',
      values: ['Q000105'],
      existingTabs: [],
    });
    expect(created[0].name).toBe('Q000105');
  });

  it('beschrijft extra filters voor de tab-hover met kolomnaam en dubbele punt', () => {
    const columns = [{ key: 'status', label: 'Status', dataType: 'text' }];
    expect(tabHoverFilterRows({ id: ALL_TAB_ID }, columns)).toEqual([{ label: '', detail: 'View filters only' }]);
    expect(tabHoverFilterRows({ id: 'tab_1', extraFilters: {} }, columns)).toEqual([{ label: '', detail: 'No extra filters' }]);
    expect(tabHoverFilterRows({
      id: 'tab_2',
      extraFilters: { status: { operator: 'equals', value: 'Open' } },
    }, columns)).toEqual([{ label: 'Status:', detail: 'is exactly Open' }]);
  });

  it('toont view-base filters ook op een kolom-tab', () => {
    const columns = [
      { key: 'itemValues', label: 'Artikel values', dataType: 'text' },
      { key: 'vendorName', label: 'Leveranciersnaam', dataType: 'text' },
    ];
    const viewBase = { itemValues: { operator: 'contains', value: 's', secondaryValue: '' } };
    expect(tabHoverFilterRows({
      id: 'tab_vendor',
      extraFilters: { vendorName: { operator: 'equals', value: 'Marisport', secondaryValue: '' } },
    }, columns, viewBase)).toEqual([
      { label: 'Artikel values:', detail: 'contains s' },
      { label: 'Leveranciersnaam:', detail: 'is exactly Marisport' },
    ]);
    expect(tabHoverFilterRows({ id: ALL_TAB_ID }, columns, viewBase)).toEqual([
      { label: 'Artikel values:', detail: 'contains s' },
    ]);
  });

  it('splitst extra filters t.o.v. de view-base', () => {
    const extra = splitExtraFilters(
      {
        status: { operator: 'equals', value: 'Invoiced', secondaryValue: '' },
        vendorAccount: { operator: 'equals', value: 'Q000104', secondaryValue: '' },
      },
      { status: { operator: 'equals', value: 'Invoiced', secondaryValue: '' } }
    );
    expect(extra).toEqual({
      vendorAccount: { operator: 'equals', value: 'Q000104', secondaryValue: '', colors: undefined },
    });
    expect(mergeFilters({ status: { operator: 'equals', value: 'Invoiced' } }, extra).vendorAccount.value).toBe('Q000104');
  });

  it('kopieert groeps-extra-filters en behoudt de split-waarde', () => {
    const source = {
      id: 'a',
      groupColumnKey: 'vendorAccount',
      extraFilters: {
        vendorAccount: { operator: 'equals', value: 'A', secondaryValue: '' },
        delivery: { operator: 'after', value: '2026-01-01', secondaryValue: '' },
      },
    };
    const other = {
      id: 'b',
      groupColumnKey: 'vendorAccount',
      extraFilters: {
        vendorAccount: { operator: 'equals', value: 'B', secondaryValue: '' },
      },
    };
    const dateTab = {
      id: 'c',
      groupColumnKey: 'delivery',
      extraFilters: { delivery: { operator: 'before', value: '2026-02-01', secondaryValue: '' } },
    };
    const next = copyGroupExtraFilters(source, [source, other, dateTab], 'vendorAccount');
    expect(next[1].extraFilters.vendorAccount.value).toBe('B');
    expect(next[1].extraFilters.delivery.value).toBe('2026-01-01');
    expect(next[2].extraFilters.delivery.value).toBe('2026-02-01');
  });

  it('kiest vendorAccount als default split-kolom', () => {
    expect(preferredSplitColumnKey([
      { key: 'status' },
      { key: 'vendorAccount' },
    ])).toBe('vendorAccount');
  });

  it('zet groepskleur per kolom en hergebruikt ongebruikte paletkleur', () => {
    const groups = upsertGroup([], 'vendorAccount', nextGroupColor([]));
    expect(groups[0].columnKey).toBe('vendorAccount');
    expect(groups[0].color).toMatch(/^#/);
    expect(inferGroupColumnKey({ extraFilters: { vendorAccount: { operator: 'equals', value: 'X' } } })).toBe('vendorAccount');
  });

  it('toont all-vendors views aan elke leverancier en scoped views alleen aan het matchende account', () => {
    expect(vendorCanSeeView({ scope: 'vendor', vendorAccount: '' }, 'Q000104')).toBe(true);
    expect(vendorCanSeeView({ scope: 'vendor', vendorAccount: 'Q000104' }, 'Q000104')).toBe(true);
    expect(vendorCanSeeView({ scope: 'vendor', vendorAccount: 'Q000104' }, 'Q000105')).toBe(false);
  });

  it('normaliseert tabs-state backwards-compatible', () => {
    const normalized = normalizeTabsState({
      extraTabs: [{ name: '  Open  ', extraFilters: { status: { operator: 'equals', value: 'Invoiced' } } }],
    });
    expect(normalized.extraTabs[0].name).toBe('Open');
    expect(normalized.groups).toEqual([]);
    const withLegacyAffix = normalizeTabsState({
      extraTabs: [{ name: 'Open', extraFilters: { status: { operator: 'equals', value: 'Open' } } }],
      groups: [{ columnKey: 'status', color: '#00c875', namePrefix: 'St', nameSuffix: 'x' }],
    });
    expect(withLegacyAffix.groups[0]).toEqual({ columnKey: 'status', color: '#00c875' });
  });

  it('vergelijkt extra filters ongeacht lege secondaryValue', () => {
    expect(extraFiltersEqual(
      { status: { operator: 'equals', value: 'Open' } },
      { status: { operator: 'equals', value: 'Open', secondaryValue: '' } },
    )).toBe(true);
    expect(extraFiltersEqual(
      { status: { operator: 'equals', value: 'Open' } },
      { status: { operator: 'equals', value: 'Closed' } },
    )).toBe(false);
  });

  it('toont vendor-nummer alleen bij een vendor-view met account', () => {
    expect(viewVendorAccount({ scope: 'vendor', vendorAccount: 'Q000104' })).toBe('Q000104');
    expect(viewVendorAccount({ scope: 'vendor', viewState: { vendorAccount: 'Q000105' } })).toBe('Q000105');
    expect(viewVendorAccount({ scope: 'global', vendorAccount: 'Q000104' })).toBe('');
    expect(viewVendorAccount({ scope: 'vendor', vendorAccount: '  ' })).toBe('');
  });

  it('zet shared/personal/vendor klein achter een opgeslagen view', () => {
    expect(viewScopeLabel({ id: '1', scope: 'global' })).toBe('shared');
    expect(viewScopeLabel({ id: '2', scope: 'personal' })).toBe('personal');
    expect(viewScopeLabel({ id: '3', scope: 'vendor' })).toBe('vendor');
    expect(viewScopeLabel({ id: null, scope: 'personal' })).toBe('');
    expect(viewScopeLabel({ scope: 'personal' })).toBe('');
    expect(viewScopeLabel(null)).toBe('');
  });

  it('verwijdert één tab of alle tabs van dezelfde groep', () => {
    const tabs = [
      { id: 'a', extraFilters: { vendorAccount: { operator: 'equals', value: 'A' } }, groupColumnKey: 'vendorAccount' },
      { id: 'b', extraFilters: { vendorAccount: { operator: 'equals', value: 'B' } }, groupColumnKey: 'vendorAccount' },
      { id: 'c', extraFilters: { status: { operator: 'equals', value: 'Open' } } },
    ];
    expect(removeTabsByScope(tabs, 'a', 'tab').map((tab) => tab.id)).toEqual(['b', 'c']);
    expect(removeTabsByScope(tabs, 'a', 'group').map((tab) => tab.id)).toEqual(['c']);
  });

  it('zet tab-onderstreep op 100% opacity voor actief en 25% voor inactief', () => {
    expect(tabUnderlineColor('#00c875', true)).toBe('#00c875');
    expect(tabUnderlineColor('#00c875', false)).toBe('#00c87540');
    expect(tabUnderlineColor('', true)).toBe('');
  });

  it('toont de tabbalk alleen wanneer er extra tabs zijn', () => {
    expect(hasExtraViewTabs([])).toBe(false);
    expect(hasExtraViewTabs(null)).toBe(false);
    expect(hasExtraViewTabs([{ id: 'tab_1' }])).toBe(true);
  });

  it('markeert extra filters die andere tabs in dezelfde groep niet hebben', () => {
    const source = {
      id: 'a',
      groupColumnKey: 'vendorAccount',
      extraFilters: {
        vendorAccount: { operator: 'equals', value: 'A', secondaryValue: '' },
        status: { operator: 'equals', value: 'Open', secondaryValue: '' },
      },
    };
    const sibling = {
      id: 'b',
      groupColumnKey: 'vendorAccount',
      extraFilters: {
        vendorAccount: { operator: 'equals', value: 'B', secondaryValue: '' },
      },
    };
    const blank = { id: 'c', extraFilters: { status: { operator: 'equals', value: 'Open' } } };
    expect(Object.keys(nonGroupExtraFilters(source))).toEqual(['status']);
    expect(tabHasUnsharedExtraFilters(source, [source, sibling])).toBe(true);
    expect(tabHasUnsharedExtraFilters(sibling, [source, sibling])).toBe(false);
    expect(tabHasUnsharedExtraFilters(blank, [blank])).toBe(false);
    const withSharedStatus = {
      ...sibling,
      extraFilters: {
        ...sibling.extraFilters,
        status: { operator: 'equals', value: 'Open', secondaryValue: '' },
      },
    };
    const withDelivery = {
      ...withSharedStatus,
      id: 'a',
      extraFilters: {
        ...withSharedStatus.extraFilters,
        delivery: { operator: 'after', value: '2026-01-01', secondaryValue: '' },
      },
    };
    expect(tabHasUnsharedExtraFilters(withDelivery, [withDelivery, withSharedStatus])).toBe(true);
    expect(tabHasUnsharedExtraFilters(withSharedStatus, [withDelivery, withSharedStatus])).toBe(false);
  });
});
