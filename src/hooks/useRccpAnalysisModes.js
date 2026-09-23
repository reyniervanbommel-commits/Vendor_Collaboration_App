import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../utils/api';
import { buildAnalysisQuery } from '../components/rccp/rccpUtils';
import { getCachedRccpAnalysis } from '../utils/rccpAnalysisPrefetch';
import {
  RCCP_PLANNING_DATE_MODES,
  rccpPlanningDateModeList,
} from '../components/rccp/rccpPeriodGrain';

/** One scope = one vendor + week window + reload token. Changing it drops every loaded mode. */
export function rccpAnalysisScopeKey({ isoWindow, vendorAccount, reloadToken = 0 } = {}) {
  if (!isoWindow) return '';
  return [
    vendorAccount || '',
    isoWindow.fromYear, isoWindow.fromWeek, isoWindow.toYear, isoWindow.toWeek,
    reloadToken,
  ].join('|');
}

const IDLE_PREFETCH_MS = 150;

/**
 * RCCP analysis per load-date mode (requested / confirmed).
 *
 * The active modes load first. As soon as they are in, the remaining mode is fetched in the
 * background, so switching load date — or switching both on — renders from state instead of
 * waiting for a new backend call. Data is kept until the vendor, week window or reload token
 * changes, which makes toggling instant for the rest of the session.
 *
 * @param {{
 *   vendorAccount?: string, isoWindow: object, modes: any, enabled?: boolean, ready?: boolean,
 *   reloadToken?: number, useCache?: boolean, debounceMs?: number, keepPrevious?: boolean
 * }} options
 * @returns {{ byMode: object, analysis: object|null, loading: boolean, error: string, patch: Function, refetch: Function }}
 * loading is true until the fresh primary mode is in — including while keepPrevious still
 * shows the previous analysis (split-view overlay spinner).
 */
export function useRccpAnalysisModes({
  vendorAccount,
  isoWindow,
  modes,
  enabled = true,
  ready = true,
  reloadToken = 0,
  useCache = true,
  debounceMs = 0,
  keepPrevious = false,
}) {
  const [store, setStore] = useState({ key: '', byMode: {}, prevByMode: {} });
  const [error, setError] = useState('');
  const storeRef = useRef(store);
  const inflightRef = useRef(new Set());
  const scopeRef = useRef('');
  storeRef.current = store;

  const activeKey = useMemo(() => rccpPlanningDateModeList(modes).join(','), [modes]);
  const activeModes = useMemo(() => activeKey.split(','), [activeKey]);
  const primaryMode = activeModes[0];
  const scopeKey = useMemo(
    () => rccpAnalysisScopeKey({ isoWindow, vendorAccount, reloadToken }),
    [isoWindow, vendorAccount, reloadToken],
  );
  const active = Boolean(enabled && ready && scopeKey);

  const fetchMode = useCallback(async (key, mode, { cacheable }) => {
    if (inflightRef.current.has(`${key}|${mode}`)) return;
    inflightRef.current.add(`${key}|${mode}`);
    try {
      // Zonder vendor (all-vendors) bestaat er geen prefetch — geen cache-lookup.
      const cached = (cacheable && vendorAccount)
        ? getCachedRccpAnalysis(isoWindow, vendorAccount, mode)
        : null;
      const data = await (cached
        || apiRequest(buildAnalysisQuery(isoWindow, vendorAccount || undefined, mode)));
      if (scopeRef.current !== key) return;
      setStore((prev) => (
        prev.key === key
          ? { ...prev, byMode: { ...prev.byMode, [mode]: data } }
          : prev
      ));
      setError('');
    } catch (err) {
      if (scopeRef.current !== key) return;
      setError(err.message || 'Failed to load RCCP analysis');
    } finally {
      inflightRef.current.delete(`${key}|${mode}`);
    }
  }, [isoWindow, vendorAccount]);

  useEffect(() => {
    if (!active) {
      scopeRef.current = '';
      inflightRef.current.clear();
      setStore((prev) => (prev.key === '' && !Object.keys(prev.byMode).length
        ? prev
        : { key: '', byMode: {}, prevByMode: {} }));
      setError('');
      return undefined;
    }
    if (scopeRef.current !== scopeKey) {
      scopeRef.current = scopeKey;
      inflightRef.current.clear();
      setStore((prev) => (prev.key === scopeKey
        ? prev
        : { key: scopeKey, byMode: {}, prevByMode: prev.byMode }));
      setError('');
    }

    let idleTimer = null;
    const startTimer = setTimeout(() => {
      const missing = activeModes.filter((mode) => !storeRef.current.byMode[mode]);
      const requests = missing.map((mode) => fetchMode(scopeKey, mode, { cacheable: useCache }));
      // Zodra de zichtbare modi binnen zijn, haal de andere load-date alvast op de achtergrond
      // op — dan is aan/uit zetten van een toggle een render, geen wachttijd.
      Promise.all(requests).then(() => {
        if (scopeRef.current !== scopeKey) return;
        const rest = RCCP_PLANNING_DATE_MODES.filter(
          (mode) => !activeModes.includes(mode) && !storeRef.current.byMode[mode],
        );
        if (!rest.length) return;
        idleTimer = setTimeout(() => {
          if (scopeRef.current !== scopeKey) return;
          rest.forEach((mode) => fetchMode(scopeKey, mode, { cacheable: useCache }));
        }, IDLE_PREFETCH_MS);
      });
    }, debounceMs);

    return () => {
      clearTimeout(startTimer);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, [active, scopeKey, activeModes, fetchMode, useCache, debounceMs]);

  /**
   * Refetch the modes that are loaded or visible, keeping the current data on screen while the
   * new analysis comes in (used after a settings save).
   */
  const refetch = useCallback(() => {
    const key = scopeRef.current;
    if (!key) return;
    RCCP_PLANNING_DATE_MODES
      .filter((mode) => activeModes.includes(mode) || storeRef.current.byMode[mode])
      .forEach((mode) => fetchMode(key, mode, { cacheable: false }));
  }, [activeModes, fetchMode]);

  /** Patch every loaded mode at once (settings save applies to both series). */
  const patch = useCallback((updater) => {
    setStore((prev) => {
      const byMode = {};
      let changed = false;
      for (const [mode, data] of Object.entries(prev.byMode)) {
        const next = updater(data);
        byMode[mode] = next;
        if (next !== data) changed = true;
      }
      return changed ? { ...prev, byMode } : prev;
    });
  }, []);

  // Tijdens een scope-wissel (andere vendor/venster) houdt keepPrevious de vorige analyse in
  // beeld tot de nieuwe binnen is — geen flikkerende lege grafiek op de PO-board split-view.
  const fresh = store.key === scopeKey ? store.byMode : {};
  const previous = store.key === scopeKey ? store.prevByMode : store.byMode;
  const byMode = (Object.keys(fresh).length || !keepPrevious) ? fresh : previous;
  const analysis = byMode[primaryMode] || null;
  // loading blijft true zolang de verse primary mode nog niet binnen is — ook als keepPrevious
  // de oude grafiek toont. De split-view zet daar een overlay-spinner op, zonder te unmounten.
  const loading = Boolean(active && !fresh[primaryMode] && !error);

  return {
    byMode,
    analysis,
    loading,
    error,
    patch,
    refetch,
  };
}
