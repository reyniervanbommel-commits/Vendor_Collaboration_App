import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../utils/api';

/**
 * useTrackChanges — laadt en beheert de globale "track changes"-configuratie.
 *
 * Houdt zelf geen JSX vast; levert alleen data en gestabiliseerde handlers zodat zowel de
 * admin Settings-tab als de board-kolomheader hierop kunnen bouwen.
 *
 * @param {{ autoLoad?: boolean }} [options]
 * @returns {{
 *   config: { mode: string, sessionRoles: string[], columns: Record<string, { activatedAt: string }> },
 *   loading: boolean,
 *   error: string,
 *   reload: () => Promise<void>,
 *   save: (next: object) => Promise<object>,
 *   setColumnEnabled: (columnId: number|string, enabled: boolean) => Promise<object>,
 *   isColumnActive: (columnId: number|string) => boolean,
 *   activeColumnIds: string[],
 * }}
 */
const DEFAULT_CONFIG = { mode: 'session', sessionRoles: ['admin', 'employee', 'supply_chain'], columns: {} };

export function useTrackChanges({ autoLoad = true } = {}) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(autoLoad);
  const [error, setError] = useState('');

  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; }, [config]);

  const applyConfig = useCallback((incoming) => {
    setConfig({ ...DEFAULT_CONFIG, ...(incoming || {}) });
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('/admin/settings/track-changes');
      applyConfig(data.config);
    } catch (err) {
      setError(err.message || 'Kon track-changes-instellingen niet laden');
    } finally {
      setLoading(false);
    }
  }, [applyConfig]);

  useEffect(() => {
    if (autoLoad) reload();
  }, [autoLoad, reload]);

  const save = useCallback(async (next) => {
    const data = await apiRequest('/admin/settings/track-changes', { method: 'POST', body: next });
    applyConfig(data.config);
    return data.config;
  }, [applyConfig]);

  const setColumnEnabled = useCallback(async (columnId, enabled) => {
    const current = configRef.current;
    const columns = { ...current.columns };
    const key = String(columnId);
    if (enabled) columns[key] = { activatedAt: new Date().toISOString() };
    else delete columns[key];
    return save({ mode: current.mode, sessionRoles: current.sessionRoles, columns });
  }, [save]);

  const activeColumnIds = useMemo(() => Object.keys(config.columns || {}), [config.columns]);

  const isColumnActive = useCallback(
    (columnId) => Object.prototype.hasOwnProperty.call(config.columns || {}, String(columnId)),
    [config.columns],
  );

  return useMemo(() => ({
    config,
    loading,
    error,
    reload,
    save,
    setColumnEnabled,
    isColumnActive,
    activeColumnIds,
  }), [config, loading, error, reload, save, setColumnEnabled, isColumnActive, activeColumnIds]);
}

export default useTrackChanges;
