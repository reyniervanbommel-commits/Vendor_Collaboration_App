import { useCallback, useEffect, useMemo, useState } from 'react';
import { subscribeRccpSettingsSaved } from './rccpSettingsSync';
import { clearPoBoardKpiCache, getPoBoardKpis } from '../utils/poBoardKpiCache';
import { aggregatePoBoardKpisFromByOrder, buildKpiQtyOverlay } from '../utils/poBoardKpis';

/**
 * Laadt en aggregeert de per-PO KPI-stats voor de zichtbare tabelrijen van het PO-board.
 * Gedeeld door PoBoardKpiStrip (grote tegels, "KPIs"-tab) en RccpSplitKpiPanel (kleine
 * tegels, rechterdeel van "Performance & Planning"-tab) zodat beide dezelfde waarden en
 * dezelfde klik-naar-filter matching gebruiken.
 *
 * `enabled=false` stelt de eerste fetch uit (geen request, `loading` blijft `true`) — gebruikt
 * door RccpSplitKpiPanel om niet gelijktijdig met de RCCP-analyse/BI-call om dezelfde trage
 * PO-cache-tabel te vragen; de "KPIs"-tab (PoBoardKpiStrip) laat dit altijd op `true` staan.
 *
 * @param {{ orders: object[], refreshKey: string|number, enabled?: boolean }} input
 * @returns {{
 *   loading: boolean, error: string, configured: boolean,
 *   kpis: object|null, kpisConfirmed: object|null, matchByKey: Record<string, Set<string>>,
 *   config: object|undefined, buildOverlay: (key: string) => object|null,
 * }}
 */
export function usePoBoardKpis({ orders, refreshKey, enabled = true }) {
  const [payload, setPayload] = useState(null);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [settingsTick, setSettingsTick] = useState(0);

  useEffect(() => subscribeRccpSettingsSaved(() => {
    clearPoBoardKpiCache();
    setSettingsTick((tick) => tick + 1);
  }), []);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    getPoBoardKpis(refreshKey)
      .then((data) => {
        if (!active) return;
        setPayload(data || { sku: [], orders: {} });
        setConfigured(data?.configured !== false);
      })
      .catch((err) => {
        if (!active) return;
        setPayload({ sku: [], orders: {} });
        setError(err?.message || 'Failed to load KPIs');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [refreshKey, settingsTick, enabled]);

  // Fingerprint i.p.v. de orders-array: het board maakt bij elke KPI-filter een nieuwe
  // rij-identiteit. Die mag dit effect niet opnieuw triggeren (update-loop / crash).
  const visibleOrderKey = (orders || []).map((order) => order?.orderNumber).filter(Boolean).join('\0');
  const visibleOrderNumbers = useMemo(
    () => (visibleOrderKey ? visibleOrderKey.split('\0') : []),
    [visibleOrderKey],
  );

  // Tegel-waarden volgen uitsluitend de tabelfilter (visibleOrderNumbers) — klikken op een
  // tegel filtert de tabel (via onKpiFilter/matchByKey) maar verandert de WAARDES van de
  // andere tegels niet meer.
  const { kpis, matchByKey } = useMemo(
    () => aggregatePoBoardKpisFromByOrder(payload, visibleOrderNumbers),
    [payload, visibleOrderNumbers],
  );
  // C/R-omdraaibare kant: confirmed-datum-basis komt uit `payload.confirmed`, over dezelfde
  // (tabelgefilterde) orderset.
  const kpisConfirmed = useMemo(() => {
    if (!payload?.confirmed) return null;
    return aggregatePoBoardKpisFromByOrder(payload.confirmed, visibleOrderNumbers).kpis;
  }, [payload, visibleOrderNumbers]);

  const buildOverlay = useCallback(
    (key) => buildKpiQtyOverlay(payload, visibleOrderNumbers, key),
    [payload, visibleOrderNumbers],
  );

  return {
    loading,
    error,
    configured,
    kpis,
    kpisConfirmed,
    matchByKey,
    config: payload?.config,
    buildOverlay,
  };
}
