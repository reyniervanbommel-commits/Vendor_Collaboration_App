import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../utils/api';
import {
  getCachedRccpConfig,
  publishRccpSettingsSync,
  subscribeRccpSettingsSync,
} from './rccpSettingsSync';

let loadPromise = null;

// Eén gedeelde lazy load van de RCCP-config (splitPanelKpiKeys) voor alle open KPI-kaarten
// tegelijk, ongeacht of de admin ooit de Settings-flyout heeft geopend deze sessie.
function ensureRccpConfigLoaded() {
  const cached = getCachedRccpConfig();
  if (cached) return Promise.resolve(cached);
  if (!loadPromise) {
    loadPromise = apiRequest('/admin/rccp/settings')
      .then((data) => {
        publishRccpSettingsSync(data?.config || null);
        return data?.config || null;
      })
      .catch(() => null)
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

/**
 * Per-kaart "Show in PO table panel"-toggle (via de vouw in het hoekje, KpiFormulaFold).
 * Schrijft direct naar de gedeelde RCCP_CONFIG (splitPanelKpiKeys) — geldt voor alle
 * gebruikers/views, geen aparte Settings-tab meer nodig.
 *
 * `enabled` moet `false` zijn voor niet-admins: het onderliggende GET/PUT is admin-only en
 * de hook wordt onvoorwaardelijk aangeroepen (React hooks-regel) — zonder deze vlag zou elke
 * medewerker/supplier die een KPI-kaart opent alsnog een (mislukkende) admin-call vuren.
 *
 * @param {string} kpiKey
 * @param {boolean} [enabled]
 * @returns {{ checked: boolean, saving: boolean, toggle: (next: boolean) => Promise<void> }}
 */
export function useSplitPanelKpiToggle(kpiKey, enabled = true) {
  const [keys, setKeys] = useState(() => getCachedRccpConfig()?.splitPanelKpiKeys || []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeRccpSettingsSync((config) => {
      setKeys(config?.splitPanelKpiKeys || []);
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    ensureRccpConfigLoaded().then((config) => {
      if (active) setKeys(config?.splitPanelKpiKeys || []);
    });
    return () => { active = false; };
  }, [enabled]);

  const toggle = useCallback(async (nextChecked) => {
    if (!enabled) return;
    const current = getCachedRccpConfig()?.splitPanelKpiKeys || keys;
    const nextKeys = nextChecked
      ? [...current, kpiKey]
      : current.filter((entry) => entry !== kpiKey);
    setSaving(true);
    try {
      const result = await apiRequest('/admin/rccp/settings/split-panel-kpis', {
        method: 'PUT',
        body: { kpiKeys: nextKeys },
      });
      // Sync (niet "saved"): deze toggle is een lichte weergavevoorkeur, geen wijziging aan
      // de RCCP-berekening zelf. "Saved" triggert elders een volledige analyse-herlading
      // (chart/matrix) — dat zou hier alle tegels tijdelijk laten verdwijnen (zie #315-bugfix),
      // voor iets dat alleen de zichtbaarheid van tegels in dit paneel raakt.
      publishRccpSettingsSync(result.config);
    } catch {
      // Config blijft ongewijzigd bij een fout; de switch veert terug naar de laatst bekende
      // stand via de eerstvolgende sync (geen losse foutmelding voor deze snelle toggle).
    } finally {
      setSaving(false);
    }
  }, [enabled, keys, kpiKey]);

  return { checked: keys.includes(kpiKey), saving, toggle };
}

/**
 * Live `splitPanelKpiKeys` voor het rechterdeel zelf (RccpSplitKpiPanel) — reageert meteen op
 * een toggle in deze sessie (via `subscribeRccpSettingsSync`, zie hierboven) zonder op de
 * (admin-only) `/admin/rccp/settings` te hoeven wachten. `fallbackKeys` (uit `analysis.config`,
 * altijd beschikbaar via `/rccp/analysis`, ook voor niet-admins) blijft gelden totdat er in
 * deze sessie een sync-event is geweest.
 *
 * @param {string[]} [fallbackKeys]
 * @returns {string[]}
 */
export function useSplitPanelKpiKeys(fallbackKeys) {
  const [override, setOverride] = useState(() => getCachedRccpConfig()?.splitPanelKpiKeys ?? null);

  useEffect(() => subscribeRccpSettingsSync((config) => {
    setOverride(config?.splitPanelKpiKeys || []);
  }), []);

  return override ?? (fallbackKeys || []);
}
