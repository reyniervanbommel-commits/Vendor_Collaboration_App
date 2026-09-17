import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../utils/api';
import { previewRule } from './useSyncFilters';

// Sync-filter-endpoints op de generieke tb_*-laag (zie useSyncFilters.js).
const syncBase = (tableKey) => `/data/${tableKey}`;
export const MAX_LAYERS = 3;

let layerCounter = 0;
function makeLayerId() {
  layerCounter += 1;
  return `layer-${Date.now()}-${layerCounter}`;
}

function emptyLayer(index) {
  return { id: makeLayerId(), name: `Layer ${index + 1}`, active: true, rules: [] };
}

// Normaliseert de datamodel-response (syncFilter.layers, of de legacy syncFilter.rules) naar het
// interne layers-formaat. Minstens 1 laag in de UI, ook als de server (nog) niets teruggeeft.
function normalizeInitialLayers(syncFilter) {
  const fromLayers = Array.isArray(syncFilter?.layers) ? syncFilter.layers : null;
  if (fromLayers && fromLayers.length) {
    return fromLayers.map((layer, index) => ({
      id: String(layer?.id || makeLayerId()),
      name: String(layer?.name || `Layer ${index + 1}`),
      active: layer?.active !== false,
      rules: Array.isArray(layer?.rules) ? layer.rules : [],
    }));
  }
  const legacyRules = Array.isArray(syncFilter?.rules) ? syncFilter.rules : [];
  return [{ id: makeLayerId(), name: 'Layer 1', active: true, rules: legacyRules }];
}

/**
 * Beheert meerdere additieve (OR) D365-sync-filter-lagen (werkitem #325): laag-CRUD (max
 * MAX_LAYERS), regel-CRUD per laag, live client-preview per laag, opslaan via
 * PUT /data/:tableKey/sync-filters ({ layers }) en tellen per laag via
 * POST /data/:tableKey/sync-filters/count ({ rules: <layer.rules> }).
 *
 * Input: syncFilter (uit het datamodel-endpoint; { layers } of legacy { rules }), tableKey.
 * Output: { layers, addLayer, removeLayer, renameLayer, toggleLayerActive, addRule, updateRule,
 *           removeRule, previewFor, countLayer, countByLayerId, countLoadingByLayerId, save,
 *           saving, error, savedAt, canAddLayer }.
 */
export function useSyncFilterLayers(syncFilter, tableKey = 'purchase-orders') {
  const [layers, setLayers] = useState(() => normalizeInitialLayers(syncFilter));
  const tableSyncBase = syncBase(tableKey);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [countByLayerId, setCountByLayerId] = useState({});
  const [countLoadingByLayerId, setCountLoadingByLayerId] = useState({});
  const [countErrorByLayerId, setCountErrorByLayerId] = useState({});

  useEffect(() => {
    setLayers(normalizeInitialLayers(syncFilter));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncFilter?.layers, syncFilter?.rules]);

  const touch = useCallback(() => setSavedAt(null), []);

  const addLayer = useCallback(() => {
    setLayers((prev) => (prev.length >= MAX_LAYERS ? prev : [...prev, emptyLayer(prev.length)]));
    touch();
  }, [touch]);

  const removeLayer = useCallback((layerId) => {
    setLayers((prev) => (prev.length <= 1 ? prev : prev.filter((layer) => layer.id !== layerId)));
    touch();
  }, [touch]);

  const renameLayer = useCallback((layerId, name) => {
    setLayers((prev) => prev.map((layer) => (layer.id === layerId ? { ...layer, name } : layer)));
    touch();
  }, [touch]);

  const toggleLayerActive = useCallback((layerId) => {
    setLayers((prev) => prev.map((layer) => (
      layer.id === layerId ? { ...layer, active: !layer.active } : layer
    )));
    touch();
  }, [touch]);

  const addRule = useCallback((layerId, defaults) => {
    setLayers((prev) => prev.map((layer) => (layer.id === layerId ? {
      ...layer,
      rules: [...layer.rules, { level: 'header', field: '', operator: 'eq', value: '', valueType: 'text', ...defaults }],
    } : layer)));
    touch();
  }, [touch]);

  const updateRule = useCallback((layerId, index, patch) => {
    setLayers((prev) => prev.map((layer) => (layer.id === layerId ? {
      ...layer,
      rules: layer.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    } : layer)));
    touch();
  }, [touch]);

  const removeRule = useCallback((layerId, index) => {
    setLayers((prev) => prev.map((layer) => (layer.id === layerId ? {
      ...layer,
      rules: layer.rules.filter((_, i) => i !== index),
    } : layer)));
    touch();
  }, [touch]);

  const previewFor = useCallback((layerId) => {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return '';
    return layer.rules.map(previewRule).filter(Boolean).join(' and ');
  }, [layers]);

  const countLayer = useCallback(async (layerId) => {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return null;
    setCountLoadingByLayerId((prev) => ({ ...prev, [layerId]: true }));
    setCountErrorByLayerId((prev) => ({ ...prev, [layerId]: '' }));
    try {
      const data = await apiRequest(`${tableSyncBase}/sync-filters/count`, {
        method: 'POST',
        body: { rules: layer.rules },
      });
      const total = Number(data?.total) || 0;
      setCountByLayerId((prev) => ({ ...prev, [layerId]: total }));
      return total;
    } catch (err) {
      setCountErrorByLayerId((prev) => ({ ...prev, [layerId]: err.message }));
      return null;
    } finally {
      setCountLoadingByLayerId((prev) => ({ ...prev, [layerId]: false }));
    }
  }, [layers, tableSyncBase]);

  const save = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      await apiRequest(`${tableSyncBase}/sync-filters`, {
        method: 'PUT',
        body: { layers: layers.map(({ id, name, active, rules }) => ({ id, name, active, rules })) },
      });
      setSavedAt(new Date());
      await Promise.all(layers.filter((layer) => layer.active).map((layer) => countLayer(layer.id)));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [layers, tableSyncBase, countLayer]);

  const canAddLayer = layers.length < MAX_LAYERS;

  return useMemo(() => ({
    layers,
    addLayer,
    removeLayer,
    renameLayer,
    toggleLayerActive,
    addRule,
    updateRule,
    removeRule,
    previewFor,
    countLayer,
    countByLayerId,
    countLoadingByLayerId,
    countErrorByLayerId,
    save,
    saving,
    error,
    savedAt,
    canAddLayer,
  }), [
    layers, addLayer, removeLayer, renameLayer, toggleLayerActive, addRule,
    updateRule, removeRule, previewFor, countLayer, countByLayerId,
    countLoadingByLayerId, countErrorByLayerId, save, saving, error, savedAt, canAddLayer,
  ]);
}
