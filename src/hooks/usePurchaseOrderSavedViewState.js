import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../utils/api';
import {
  ALL_ORDERS_SETTINGS_BOARD_KEY,
  describeHistoryToggle,
  readAllOrdersHistoryFromSettings,
} from '../utils/allOrdersHistoryPreference';
import { usePurchaseOrderSavedViews } from './usePurchaseOrderSavedViews';
import { usePurchaseOrderViewTabs } from './usePurchaseOrderViewTabs';
import { ALL_TAB_ID, normalizeTabsState } from '../utils/viewTabs';
import { pickStartupView } from '../utils/purchaseOrderStartupView';
import { readPoTableSession } from '../utils/poTableSessionState';
import { usePurchaseOrderTableSession } from './usePurchaseOrderTableSession';
import { describeViewStateDiff, stableSerializeViewState } from '../utils/viewStateDiff';

const BOARD_KEY = 'purchase-orders';

/**
 * Bundelt saved-view state en handlers voor de purchase-order board.
 */
export function usePurchaseOrderSavedViewState({
  orders,
  loading,
  exportColumnLayout,
  applyColumnLayout,
  boardView,
  isSupplier = false,
  columns = [],
  datePeriodDisplayModes = {},
}) {
  const savedViews = usePurchaseOrderSavedViews({ boardKey: BOARD_KEY });
  const [activeViewId, setActiveViewId] = useState(null);
  const [savedStateFingerprint, setSavedStateFingerprint] = useState(null);
  const [stickyColumnKeys, setStickyColumnKeys] = useState([]);
  const [showHistoryIndicators, setShowHistoryIndicators] = useState(true);
  const [allOrdersShowHistoryIndicators, setAllOrdersShowHistoryIndicators] = useState(true);
  const autoAppliedRef = useRef(false);
  const activeViewIdRef = useRef(activeViewId);
  const allOrdersDirtyRef = useRef(false);
  const savedViewStateRef = useRef(null);
  activeViewIdRef.current = activeViewId;
  const viewTabs = usePurchaseOrderViewTabs({
    activeViewId,
    boardView,
    columns,
    allItems: boardView.allItems || orders,
    datePeriodDisplayModes,
  });
  const tableSession = usePurchaseOrderTableSession({ boardView, activeViewId });

  const buildCurrentViewState = useCallback(() => {
    const peek = viewTabs.peekTabsState();
    const table = boardView.exportFilterSortGrouping();
    return {
      showHistoryIndicators,
      vendorAccount: savedViews.views.find((view) => view.id === activeViewId)?.viewState?.vendorAccount || '',
      columns: {
        ...exportColumnLayout(),
        stickyColumnKeys,
      },
      table: {
        ...table,
        filterByColumn: peek.viewBaseFilters,
      },
      tabs: {
        extraTabs: peek.extraTabs,
        groups: peek.groups,
      },
    };
  }, [activeViewId, boardView, exportColumnLayout, savedViews.views, stickyColumnKeys, showHistoryIndicators, viewTabs]);

  const buildCurrentFingerprint = useCallback(
    () => stableSerializeViewState(buildCurrentViewState()),
    [buildCurrentViewState]
  );

  const getUnsavedViewDiff = useCallback((options = {}) => {
    if (!activeViewId || !savedViewStateRef.current) return { rows: [], moreCount: 0 };
    return describeViewStateDiff(savedViewStateRef.current, buildCurrentViewState(), {
      columns,
      maxRows: Number.isFinite(options.maxRows) ? options.maxRows : 250,
    });
  }, [activeViewId, buildCurrentViewState, columns]);

  const hasUnsavedChanges = useMemo(() => {
    if (!activeViewId || !savedStateFingerprint) return false;
    return buildCurrentFingerprint() !== savedStateFingerprint;
  }, [activeViewId, savedStateFingerprint, buildCurrentFingerprint]);

  const applyViewState = useCallback((view) => {
    tableSession.overlayAfter(view?.id ?? null, () => {
      const state = view?.viewState || {};
      applyColumnLayout(state.columns);
      setStickyColumnKeys(Array.isArray(state.columns?.stickyColumnKeys) ? state.columns.stickyColumnKeys : []);
      if (!readPoTableSession(view?.id ?? null)) {
        boardView.applyFilterSortGrouping(state.table);
      }
      setShowHistoryIndicators(state.showHistoryIndicators !== false);
      setActiveViewId(view?.id ?? null);
      if (view?.id) {
        viewTabs.loadFromViewState({ ...state, viewId: view.id });
        const nextSaved = {
          ...state,
          vendorAccount: state.vendorAccount || '',
          tabs: normalizeTabsState(state.tabs),
        };
        savedViewStateRef.current = nextSaved;
        setSavedStateFingerprint(stableSerializeViewState(nextSaved));
      } else {
        viewTabs.resetTabs();
        savedViewStateRef.current = null;
        setSavedStateFingerprint(null);
      }
    });
  }, [applyColumnLayout, boardView, tableSession, viewTabs]);

  const persistAllOrdersHistory = useCallback((enabled) => {
    allOrdersDirtyRef.current = true;
    void apiRequest(`/supplier/board-settings/${ALL_ORDERS_SETTINGS_BOARD_KEY}`, {
      method: 'PATCH',
      body: { settings: { allOrdersShowHistoryIndicators: Boolean(enabled) } },
    }).catch(() => {});
  }, []);

  // Wist de sessie-snapshot van de actieve view meteen (synchroon), zodat een filter die de
  // gebruiker net heeft gewist niet alsnog terugkomt via de sessie-overlay bij een snelle
  // view/tab-switch die vlak daarna volgt (#PO-filter-sticky).
  const clearActiveViewFilterSession = useCallback(() => {
    tableSession.clear(activeViewId);
  }, [tableSession, activeViewId]);

  const handleResetView = useCallback(() => {
    tableSession.clear(activeViewId);
    boardView.clearAllFilters();
    boardView.clearSort();
    boardView.clearGrouping();
    boardView.clearGroupSummaries();
    boardView.columnSums?.clearColumnSums?.();
    // "All orders" is een neutrale weergave: geen conditional formatting die van een
    // andere (opgeslagen) view is blijven hangen. In-memory only, niet persistent.
    applyColumnLayout({ headerColumnFormatRules: {}, lineColumnFormatRules: {} });
    setShowHistoryIndicators(allOrdersShowHistoryIndicators);
    setActiveViewId(null);
    savedViewStateRef.current = null;
    setSavedStateFingerprint(null);
    viewTabs.resetTabs();
  }, [applyColumnLayout, boardView, allOrdersShowHistoryIndicators, tableSession, activeViewId, viewTabs]);

  const handleSaveAsNew = useCallback(async ({ name, scope, isDefault, vendorAccount }) => {
    const currentState = {
      ...buildCurrentViewState(),
      vendorAccount: vendorAccount || '',
      tabs: { extraTabs: [], groups: [] },
    };
    const currentFingerprint = stableSerializeViewState(currentState);
    const created = await savedViews.createView({
      name,
      scope,
      viewState: currentState,
      isDefault,
    });
    if (created?.id) {
      tableSession.suppressNextPersist();
      tableSession.clear(created.id);
      setActiveViewId(created.id);
      savedViewStateRef.current = currentState;
      setSavedStateFingerprint(currentFingerprint);
      viewTabs.loadFromViewState({ ...currentState, viewId: created.id });
    }
    return created;
  }, [savedViews, buildCurrentViewState, tableSession, viewTabs]);

  const handleUpdateActive = useCallback(async (view, saveScope = 'all') => {
    let extraTabs = viewTabs.peekTabsState().extraTabs;
    if (saveScope === 'group' && viewTabs.activeTabId !== ALL_TAB_ID) {
      extraTabs = viewTabs.applySaveScope('group');
    } else {
      viewTabs.snapshotCurrentTab();
      extraTabs = viewTabs.peekTabsState().extraTabs;
    }
    const currentState = {
      ...buildCurrentViewState(),
      tabs: { extraTabs, groups: viewTabs.groups },
    };
    await savedViews.updateView(view.id, { viewState: currentState });
    tableSession.suppressNextPersist();
    tableSession.clear(view.id);
    savedViewStateRef.current = currentState;
    setSavedStateFingerprint(stableSerializeViewState(currentState));
  }, [savedViews, buildCurrentViewState, tableSession, viewTabs]);

  const handleRenameView = useCallback(async (view, name) => {
    await savedViews.updateView(view.id, { name });
  }, [savedViews]);

  const handleSetDefault = useCallback(async (view) => {
    await savedViews.updateView(view.id, { isDefault: true });
  }, [savedViews]);

  const handleDeleteView = useCallback(async (view) => {
    await savedViews.deleteView(view.id);
    tableSession.clear(view.id);
    if (view.id === activeViewId) {
      applyColumnLayout({ headerColumnFormatRules: {}, lineColumnFormatRules: {} });
      setShowHistoryIndicators(allOrdersShowHistoryIndicators);
      setActiveViewId(null);
      savedViewStateRef.current = null;
      setSavedStateFingerprint(null);
      viewTabs.resetTabs();
    }
  }, [savedViews, activeViewId, allOrdersShowHistoryIndicators, applyColumnLayout, tableSession, viewTabs]);

  const handleToggleShowHistory = useCallback(async (view, enabled) => {
    const nextEnabled = Boolean(enabled);
    const decision = describeHistoryToggle({
      view,
      activeViewId,
      enabled: nextEnabled,
      allOrdersPreference: allOrdersShowHistoryIndicators,
    });
    if (decision.updateLive) {
      setShowHistoryIndicators(nextEnabled);
    }
    if (!decision.persistView) {
      setAllOrdersShowHistoryIndicators(decision.nextAllOrdersPreference);
      persistAllOrdersHistory(decision.nextAllOrdersPreference);
      return;
    }
    const nextViewState = {
      ...(view?.viewState || {}),
      showHistoryIndicators: nextEnabled,
    };
    await savedViews.updateView(view.id, { viewState: nextViewState });
    if (decision.updateLive) {
      savedViewStateRef.current = nextViewState;
      setSavedStateFingerprint(stableSerializeViewState(nextViewState));
    }
  }, [activeViewId, allOrdersShowHistoryIndicators, persistAllOrdersHistory, savedViews]);

  useEffect(() => {
    let cancelled = false;
    apiRequest(`/supplier/board-settings/${ALL_ORDERS_SETTINGS_BOARD_KEY}`)
      .then((data) => {
        if (cancelled || allOrdersDirtyRef.current) return;
        const next = readAllOrdersHistoryFromSettings(data?.settings);
        setAllOrdersShowHistoryIndicators(next);
        if (activeViewIdRef.current == null) {
          setShowHistoryIndicators(next);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (autoAppliedRef.current) return;
    const boardReady = !savedViews.loading && !loading && (isSupplier || orders.length > 0);
    if (!boardReady) return;
    autoAppliedRef.current = true;
    const defaultView = pickStartupView(savedViews.views, isSupplier);
    if (defaultView) {
      applyViewState(defaultView);
    } else {
      // Start op "All orders": geen conditional formatting uit een eerder
      // bezochte view laten doorschemeren. In-memory only, niet persistent.
      applyColumnLayout({ headerColumnFormatRules: {}, lineColumnFormatRules: {} });
      tableSession.restore(null);
    }
    tableSession.enablePersist();
  }, [savedViews.loading, savedViews.views, loading, orders.length, applyViewState, applyColumnLayout, isSupplier, tableSession]);

  return useMemo(() => ({
    savedViews,
    activeViewId,
    applyViewState,
    handleResetView,
    handleSaveAsNew,
    handleUpdateActive,
    handleRenameView,
    handleSetDefault,
    handleDeleteView,
    handleToggleShowHistory,
    hasUnsavedChanges,
    getUnsavedViewDiff,
    showHistoryIndicators,
    allOrdersShowHistoryIndicators,
    stickyColumnKeys,
    setStickyColumnKeys,
    viewTabs,
    clearActiveViewFilterSession,
  }), [
    savedViews,
    activeViewId,
    applyViewState,
    handleResetView,
    handleSaveAsNew,
    handleUpdateActive,
    handleRenameView,
    handleSetDefault,
    handleDeleteView,
    handleToggleShowHistory,
    hasUnsavedChanges,
    getUnsavedViewDiff,
    showHistoryIndicators,
    allOrdersShowHistoryIndicators,
    stickyColumnKeys,
    viewTabs,
    clearActiveViewFilterSession,
  ]);
}
