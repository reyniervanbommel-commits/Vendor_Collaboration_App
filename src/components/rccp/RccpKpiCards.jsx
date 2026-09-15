import React, { memo, useCallback } from 'react';
import { makeStyles, tokens, shorthands } from '@fluentui/react-components';
import { PO_BOARD_CLICKABLE_KPI_KEYS } from '../../utils/poBoardKpis';
import KpiCardStyleProvider from './KpiCardStyleProvider';
import KpiCard, { formatDays, formatItems, formatPct } from './RccpKpiCard';

const useStyles = makeStyles({
  row: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))',
    alignItems: 'stretch',
    ...shorthands.gap(tokens.spacingHorizontalM),
  },
});

function RccpKpiCards({ kpis, selectedKey = '', onSelect, clickableKeys, config }) {
  const styles = useStyles();
  const handleActivate = useCallback((key) => {
    onSelect?.(key);
  }, [onSelect]);
  if (!kpis) return null;
  const clickable = Boolean(onSelect);
  const clickableSet = clickable
    ? new Set(clickableKeys || PO_BOARD_CLICKABLE_KPI_KEYS)
    : new Set();
  const uniqueLateItems = kpis.lateDeliveryItemCount;
  return (
    <KpiCardStyleProvider>
    <div className={styles.row} data-tour="rccp-kpis">
      <KpiCard
        kpiKey="ordered"
        label="Total ordered"
        qty={kpis.totalOrdered}
        hash
        selected={selectedKey === 'ordered'}
        clickable={clickableSet.has('ordered')}
        onActivate={handleActivate}
        config={config}
      />
      <KpiCard
        kpiKey="delivered"
        label="Total delivered"
        qty={kpis.totalDelivered}
        hash
        pct={formatPct(kpis.deliveredPercent)}
        selected={selectedKey === 'delivered'}
        clickable={clickableSet.has('delivered')}
        onActivate={handleActivate}
        config={config}
      />
      <KpiCard
        kpiKey="open"
        label="Total open"
        qty={kpis.totalOpen}
        hash
        aside={formatItems(kpis.openItemCount)}
        pct={formatPct(kpis.openPercent)}
        selected={selectedKey === 'open'}
        clickable={clickableSet.has('open')}
        onActivate={handleActivate}
        config={config}
      />
      <KpiCard
        kpiKey="lateDelivery"
        label="Late delivery"
        qty={kpis.lateDeliveryUnits}
        hash
        aside={formatItems(uniqueLateItems)}
        pct={formatPct(kpis.lateDeliveryPercent)}
        selected={selectedKey === 'lateDelivery'}
        clickable={clickableSet.has('lateDelivery')}
        onActivate={handleActivate}
        config={config}
      />
      <KpiCard
        kpiKey="onTime"
        label="On time delivery"
        qty={kpis.onTimeUnits}
        hash
        aside={formatItems(kpis.onTimeItemCount)}
        pct={formatPct(kpis.onTimePercent)}
        selected={selectedKey === 'onTime'}
        clickable={clickableSet.has('onTime')}
        onActivate={handleActivate}
        config={config}
      />
      <KpiCard
        kpiKey="openLate"
        label="Open and late"
        qty={kpis.openLateUnits}
        hash
        aside={formatItems(kpis.openLateItemCount)}
        detail={formatDays(kpis.openLateAvgDays)}
        selected={selectedKey === 'openLate'}
        clickable={clickableSet.has('openLate')}
        onActivate={handleActivate}
        config={config}
      />
      <KpiCard
        kpiKey="lateItems"
        label="Average days late"
        qty={kpis.lateDeliveryAvgDays}
        hash="Ø"
        aside="days late"
        selected={selectedKey === 'lateItems'}
        clickable={clickableSet.has('lateItems')}
        onActivate={handleActivate}
        config={config}
      />
      <KpiCard
        kpiKey="unconfirmed"
        label="Not confirmed"
        qty={kpis.unconfirmedUnits}
        hash
        aside={formatItems(kpis.unconfirmedItemCount)}
        pct={formatPct(kpis.unconfirmedPercent)}
        selected={selectedKey === 'unconfirmed'}
        clickable={clickableSet.has('unconfirmed')}
        onActivate={handleActivate}
        config={config}
      />
      <KpiCard
        kpiKey="capacityShortfall"
        label="Capacity shortfall"
        qty={kpis.capacityShortfall}
        hash
        selected={selectedKey === 'capacityShortfall'}
        clickable={clickableSet.has('capacityShortfall')}
        onActivate={handleActivate}
        config={config}
      />
      <KpiCard
        kpiKey="overloadedWeeks"
        label="Overloaded weeks"
        qty={kpis.overloadedWeeks}
        hash
        selected={selectedKey === 'overloadedWeeks'}
        clickable={clickableSet.has('overloadedWeeks')}
        onActivate={handleActivate}
        config={config}
      />
    </div>
    </KpiCardStyleProvider>
  );
}

export default memo(RccpKpiCards);

