import { useCallback, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../utils/api';
import { getCachedBoardSettings } from '../utils/boardPresentationCache';
import {
  ALL_TAB_ID,
  buildBulkTabs,
  copyGroupExtraFilters,
  createTabId,
  filterRowsByFilters,
  inferGroupColumnKey,
  mergeFilters,
  nextGroupColor,
  normalizeTabsState,
  splitExtraFilters,
  tabHasUnsharedExtraFilters,
  uniqueColumnValues,
  upsertGroup,
  removeTabsByScope,
} from '../utils/viewTabs';
import { orderItemsByIds } from '../utils/tabOrder';
import { useViewTabExtraFilterPrompt } from './useViewTabExtraFilterPrompt';

const BOARD_KEY = 'purchase-orders';

/**
 * Draft tab-set van de actieve saved view. Extra tabs voegen alleen filters toe;
 * Save persist naar view_state.tabs.
 */
export function usePurchaseOrderViewTabs({
  activeViewId,
  boardView,
  columns = [],
  allItems = [],
  datePeriodDisplayModes = {},
}) {
  const [extraTabs, setExtraTabs] = useState([]);
  const [groups, setGroups] = useState([]);
  const [activeTabId, setActiveTabId] = useState(ALL_TAB_ID);
  const [viewBaseFilters, setViewBaseFilters] = useState({});
  const viewBaseRef = useRef(viewBaseFilters);
  const extraTabsRef = useRef(extraTabs);
  const activeTabIdRef = useRef(activeTabId);
  viewBaseRef.current = viewBaseFilters;
  extraTabsRef.current = extraTabs;
  activeTabIdRef.current = activeTabId;

  const snapshotCurrentTab = useCallback(() => {
    const live = boardView.exportFilterSortGrouping()?.filterByColumn || {};
    if (activeTabIdRef.current === ALL_TAB_ID) {
      const cloned = splitExtraFilters(live, {});
      setViewBaseFilters(cloned);
      viewBaseRef.current = cloned;
      return { viewBaseFilters: cloned, extraTabs: extraTabsRef.current };
    }
    const extra = splitExtraFilters(live, viewBaseRef.current);
    const nextTabs = extraTabsRef.current.map((tab) => (
      tab.id === activeTabIdRef.current ? { ...tab, extraFilters: extra } : tab
    ));
    setExtraTabs(nextTabs);
    extraTabsRef.current = nextTabs;
    return { viewBaseFilters: viewBaseRef.current, extraTabs: nextTabs };
  }, [boardView]);

  const { skipFilterPrompt } = useViewTabExtraFilterPrompt({
    activeTabId,
    boardView,
    extraTabsRef,
    viewBaseRef,
    onExtraChange: snapshotCurrentTab,
  });

  const applyMergedFilters = useCallback((baseFilters, extraFilters) => {
    skipFilterPrompt();
    const exported = boardView.exportFilterSortGrouping();
    boardView.applyFilterSortGrouping({
      ...exported,
      filterByColumn: mergeFilters(baseFilters, extraFilters),
    });
  }, [boardView, skipFilterPrompt]);

  const loadFromViewState = useCallback((viewState) => {
    skipFilterPrompt();
    const tabs = normalizeTabsState(viewState?.tabs);
    const baseFilters = viewState?.table?.filterByColumn && typeof viewState.table.filterByColumn === 'object'
      ? viewState.table.filterByColumn
      : {};
    setExtraTabs(tabs.extraTabs);
    setGroups(tabs.groups);
    setViewBaseFilters(baseFilters);
    extraTabsRef.current = tabs.extraTabs;
    viewBaseRef.current = baseFilters;
    const lastId = viewState?.lastTabId
      || getCachedBoardSettings(BOARD_KEY)?.viewTabSelection?.[String(viewState?.viewId || '')];
    const restored = lastId && lastId !== ALL_TAB_ID && tabs.extraTabs.some((tab) => tab.id === lastId)
      ? lastId
      : ALL_TAB_ID;
    setActiveTabId(restored);
    activeTabIdRef.current = restored;
    if (restored !== ALL_TAB_ID) {
      const tab = tabs.extraTabs.find((entry) => entry.id === restored);
      applyMergedFilters(baseFilters, tab?.extraFilters || {});
    }
  }, [applyMergedFilters, skipFilterPrompt]);

  const resetTabs = useCallback(() => {
    setExtraTabs([]);
    setGroups([]);
    setViewBaseFilters({});
    extraTabsRef.current = [];
    viewBaseRef.current = {};
    setActiveTabId(ALL_TAB_ID);
    activeTabIdRef.current = ALL_TAB_ID;
  }, []);

  const persistTabSelection = useCallback((viewId, tabId) => {
    if (!viewId) return;
    void apiRequest(`/supplier/board-settings/${BOARD_KEY}`, {
      method: 'PATCH',
      body: { settings: { viewTabSelection: { [String(viewId)]: tabId || ALL_TAB_ID } } },
    }).catch(() => {});
  }, []);

  const selectTab = useCallback((tabId) => {
    snapshotCurrentTab();
    const nextId = tabId || ALL_TAB_ID;
    setActiveTabId(nextId);
    activeTabIdRef.current = nextId;
    if (nextId === ALL_TAB_ID) {
      applyMergedFilters(viewBaseRef.current, {});
    } else {
      const tab = extraTabsRef.current.find((entry) => entry.id === nextId);
      applyMergedFilters(viewBaseRef.current, tab?.extraFilters || {});
    }
    persistTabSelection(activeViewId, nextId);
  }, [activeViewId, applyMergedFilters, persistTabSelection, snapshotCurrentTab]);

  const addBlankTab = useCallback((name) => {
    snapshotCurrentTab();
    const tab = {
      id: createTabId(),
      name: String(name || 'New tab').trim().slice(0, 120) || 'New tab',
      extraFilters: {},
      groupColumnKey: '',
    };
    const next = [...extraTabsRef.current, tab];
    setExtraTabs(next);
    extraTabsRef.current = next;
    setActiveTabId(tab.id);
    activeTabIdRef.current = tab.id;
    applyMergedFilters(viewBaseRef.current, {});
    return tab;
  }, [applyMergedFilters, snapshotCurrentTab]);

  const removeTab = useCallback((tabId, scope = 'tab') => {
    snapshotCurrentTab();
    const next = removeTabsByScope(extraTabsRef.current, tabId, scope);
    const keepActive = next.some((tab) => tab.id === activeTabIdRef.current);
    setExtraTabs(next);
    extraTabsRef.current = next;
    if (keepActive) return;
    setActiveTabId(ALL_TAB_ID);
    activeTabIdRef.current = ALL_TAB_ID;
    applyMergedFilters(viewBaseRef.current, {});
  }, [applyMergedFilters, snapshotCurrentTab]);

  const addTabsFromColumn = useCallback(({ columnKey, color }) => {
    skipFilterPrompt();
    snapshotCurrentTab();
    const column = columns.find((entry) => entry.key === columnKey);
    const scopedRows = filterRowsByFilters(allItems, columns, viewBaseRef.current, datePeriodDisplayModes);
    const values = uniqueColumnValues(scopedRows, columnKey);
    const created = buildBulkTabs({
      column,
      columnKey,
      values,
      existingTabs: extraTabsRef.current,
    });
    const nextTabs = [...extraTabsRef.current, ...created];
    const nextGroups = upsertGroup(groups, columnKey, color || nextGroupColor(groups));
    setExtraTabs(nextTabs);
    extraTabsRef.current = nextTabs;
    setGroups(nextGroups);
    return created.length;
  }, [allItems, columns, datePeriodDisplayModes, groups, skipFilterPrompt, snapshotCurrentTab]);

  // Draft change like add/remove: marks the view unsaved; Save persists the order.
  const reorderTabs = useCallback((orderedIds) => {
    const snap = snapshotCurrentTab();
    const next = orderItemsByIds(snap.extraTabs, orderedIds, (tab) => tab.id);
    setExtraTabs(next);
    extraTabsRef.current = next;
  }, [snapshotCurrentTab]);

  const setGroupColor = useCallback((columnKey, color) => {
    setGroups((prev) => upsertGroup(prev, columnKey, color));
  }, []);

  const exportTabsState = useCallback(() => {
    const snap = snapshotCurrentTab();
    return {
      extraTabs: snap.extraTabs,
      groups,
    };
  }, [groups, snapshotCurrentTab]);

  const exportViewBaseFilters = useCallback(() => {
    const snap = snapshotCurrentTab();
    return snap.viewBaseFilters;
  }, [snapshotCurrentTab]);

  const applySaveScope = useCallback((scope) => {
    const snap = snapshotCurrentTab();
    if (scope !== 'group' || activeTabIdRef.current === ALL_TAB_ID) {
      return snap.extraTabs;
    }
    const source = snap.extraTabs.find((tab) => tab.id === activeTabIdRef.current);
    if (!source) return snap.extraTabs;
    const groupKey = inferGroupColumnKey(source);
    const next = copyGroupExtraFilters(source, snap.extraTabs, groupKey);
    setExtraTabs(next);
    extraTabsRef.current = next;
    return next;
  }, [snapshotCurrentTab]);

  const uniqueValueCount = useCallback((columnKey) => {
    const scopedRows = filterRowsByFilters(allItems, columns, viewBaseRef.current, datePeriodDisplayModes);
    return uniqueColumnValues(scopedRows, columnKey).length;
  }, [allItems, columns, datePeriodDisplayModes]);

  const peekTabsState = useCallback(() => {
    const live = boardView.exportFilterSortGrouping()?.filterByColumn || {};
    if (activeTabId === ALL_TAB_ID) {
      return { viewBaseFilters: live, extraTabs, groups };
    }
    const extra = splitExtraFilters(live, viewBaseFilters);
    return {
      viewBaseFilters,
      extraTabs: extraTabs.map((tab) => (
        tab.id === activeTabId ? { ...tab, extraFilters: extra } : tab
      )),
      groups,
    };
  }, [activeTabId, boardView, extraTabs, groups, viewBaseFilters]);

  const unsavedExtraTabIds = useMemo(() => {
    const tabs = peekTabsState().extraTabs;
    return tabs.filter((tab) => tabHasUnsharedExtraFilters(tab, tabs)).map((tab) => tab.id);
  }, [boardView.filterByColumn, peekTabsState]);

  return useMemo(() => ({
    activeTabId,
    extraTabs,
    groups,
    viewBaseFilters,
    selectTab,
    addBlankTab,
    removeTab,
    reorderTabs,
    addTabsFromColumn,
    setGroupColor,
    loadFromViewState,
    resetTabs,
    snapshotCurrentTab,
    exportTabsState,
    exportViewBaseFilters,
    applySaveScope,
    uniqueValueCount,
    peekTabsState,
    unsavedExtraTabIds,
    hasExtraTabs: extraTabs.length > 0,
  }), [
    activeTabId,
    extraTabs,
    groups,
    viewBaseFilters,
    selectTab,
    addBlankTab,
    removeTab,
    reorderTabs,
    addTabsFromColumn,
    setGroupColor,
    loadFromViewState,
    resetTabs,
    snapshotCurrentTab,
    exportTabsState,
    exportViewBaseFilters,
    applySaveScope,
    uniqueValueCount,
    peekTabsState,
    unsavedExtraTabIds,
  ]);
}
