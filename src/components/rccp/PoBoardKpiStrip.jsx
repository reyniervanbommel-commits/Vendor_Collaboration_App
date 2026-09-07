import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Spinner, Text, makeStyles, tokens } from '@fluentui/react-components';
import { subscribeRccpSettingsSaved } from '../../hooks/rccpSettingsSync';
import { clearPoBoardKpiCache, getPoBoardKpis } from '../../utils/poBoardKpiCache';
import { aggregatePoBoardKpisFromByOrder, buildKpiQtyOverlay } from '../../utils/poBoardKpis';
import RccpKpiCards from './RccpKpiCards';

const useStyles = makeStyles({
  hint: { color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalS },
  error: { color: tokens.colorPaletteRedForeground1, marginBottom: tokens.spacingVerticalS },
});

function PoBoardKpiStrip({ orders, selectedKey, onKpiFilter, refreshKey }) {
  const styles = useStyles();
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
  }, [refreshKey, settingsTick]);

  // Fingerprint i.p.v. de orders-array: het board maakt bij elke KPI-filter een nieuwe
  // rij-identiteit. Die mag de sync-effect niet opnieuw triggeren (update-loop / crash).
  const visibleOrderKey = (orders || []).map((order) => order?.orderNumber).filter(Boolean).join('\0');
  const visibleOrderNumbers = useMemo(
    () => (visibleOrderKey ? visibleOrderKey.split('\0') : []),
    [visibleOrderKey],
  );

  const { kpis, matchByKey } = useMemo(
    () => aggregatePoBoardKpisFromByOrder(payload, visibleOrderNumbers),
    [payload, visibleOrderNumbers],
  );

  const handleSelect = useCallback((key) => {
    onKpiFilter?.(key, matchByKey[key] || new Set(), {
      qtyOverlay: buildKpiQtyOverlay(payload, visibleOrderNumbers, key),
    });
  }, [matchByKey, onKpiFilter, payload, visibleOrderNumbers]);

  useEffect(() => {
    if (!selectedKey) return;
    onKpiFilter?.(selectedKey, matchByKey[selectedKey] || new Set(), {
      toggle: false,
      qtyOverlay: buildKpiQtyOverlay(payload, visibleOrderNumbers, selectedKey),
    });
  }, [matchByKey, onKpiFilter, payload, selectedKey, visibleOrderNumbers]);

  if (loading) return <Spinner size="tiny" label="Loading KPIs…" />;
  if (error) return <Text className={styles.error}>{error}</Text>;
  if (!configured) {
    return <Text className={styles.hint}>KPI columns are not configured yet.</Text>;
  }

  return (
    <RccpKpiCards
      kpis={kpis}
      selectedKey={selectedKey}
      onSelect={handleSelect}
      config={payload?.config}
    />
  );
}

export default memo(PoBoardKpiStrip);
