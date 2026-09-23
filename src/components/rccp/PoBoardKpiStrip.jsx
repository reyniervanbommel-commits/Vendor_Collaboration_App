import React, { memo, useCallback, useEffect } from 'react';
import { Spinner, Text, makeStyles, tokens } from '@fluentui/react-components';
import { usePoBoardKpis } from '../../hooks/usePoBoardKpis';
import RccpKpiCards from './RccpKpiCards';

const useStyles = makeStyles({
  hint: { color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalS },
  error: { color: tokens.colorPaletteRedForeground1, marginBottom: tokens.spacingVerticalS },
  // Alleen de PO-tabel KPIs-tab: de %-pil zat visueel op de balk.
  strip: {
    '& [data-kpi-pct-badge]': {
      position: 'relative',
      top: `calc(${tokens.spacingVerticalS} * -1)`,
    },
  },
});

function PoBoardKpiStrip({ orders, selectedKey, onKpiFilter, refreshKey, dateMode = 'requested' }) {
  const styles = useStyles();
  const {
    loading, error, configured, kpis, kpisConfirmed, matchByKey, config, buildOverlay,
  } = usePoBoardKpis({ orders, refreshKey, dateMode });

  const handleSelect = useCallback((key) => {
    onKpiFilter?.(key, matchByKey[key] || new Set(), { qtyOverlay: buildOverlay(key) });
  }, [matchByKey, onKpiFilter, buildOverlay]);

  useEffect(() => {
    if (!selectedKey) return;
    onKpiFilter?.(selectedKey, matchByKey[selectedKey] || new Set(), {
      toggle: false,
      qtyOverlay: buildOverlay(selectedKey),
    });
  }, [matchByKey, onKpiFilter, selectedKey, buildOverlay]);

  if (loading) return <Spinner size="tiny" label="Loading KPIs…" />;
  if (error) return <Text className={styles.error}>{error}</Text>;
  if (!configured) {
    return <Text className={styles.hint}>KPI columns are not configured yet.</Text>;
  }

  return (
    <div className={styles.strip}>
      <RccpKpiCards
        kpis={kpis}
        kpisConfirmed={kpisConfirmed}
        selectedKey={selectedKey}
        onSelect={handleSelect}
        config={config}
        dateMode={dateMode}
      />
    </div>
  );
}

export default memo(PoBoardKpiStrip);
