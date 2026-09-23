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
    ...shorthands.gap(tokens.spacingVerticalL, tokens.spacingHorizontalL),
  },
});

function RccpKpiCards({
  kpis, kpisConfirmed = null, selectedKey = '', onSelect, clickableKeys, config, dateMode = 'requested',
}) {
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
  // C/R-omdraaibare kant: elke tegel krijgt (indien beschikbaar) een confirmed-datum-basis
  // bundel met dezelfde vorm als de props die de tegel normaal krijgt. Capacity-KPI's
  // hebben geen datum-basis, dus die tegels krijgen geen confirmed-variant.
  const c = kpisConfirmed;
  return (
    <KpiCardStyleProvider>
    <div className={styles.row} data-tour="rccp-kpis">
      <KpiCard
        kpiKey="ordered"
        label="Total ordered"
        qty={kpis.totalOrdered}
        hash
        confirmed={c ? { qty: c.totalOrdered, hash: true } : null}
        selected={selectedKey === 'ordered'}
        clickable={clickableSet.has('ordered')}
        onActivate={handleActivate}
        config={config}
        dateMode={dateMode}
      />
      <KpiCard
        kpiKey="delivered"
        label="Total delivered"
        qty={kpis.totalDelivered}
        hash
        pct={formatPct(kpis.deliveredPercent)}
        confirmed={c ? { qty: c.totalDelivered, hash: true, pct: formatPct(c.deliveredPercent) } : null}
        selected={selectedKey === 'delivered'}
        clickable={clickableSet.has('delivered')}
        onActivate={handleActivate}
        config={config}
        dateMode={dateMode}
      />
      <KpiCard
        kpiKey="open"
        label="Total open"
        qty={kpis.totalOpen}
        hash
        aside={formatItems(kpis.openItemCount)}
        pct={formatPct(kpis.openPercent)}
        confirmed={c ? {
          qty: c.totalOpen, hash: true, aside: formatItems(c.openItemCount), pct: formatPct(c.openPercent),
        } : null}
        selected={selectedKey === 'open'}
        clickable={clickableSet.has('open')}
        onActivate={handleActivate}
        config={config}
        dateMode={dateMode}
      />
      <KpiCard
        kpiKey="lateDelivery"
        label="Late delivery"
        qty={kpis.lateDeliveryUnits}
        hash
        aside={formatItems(uniqueLateItems)}
        pct={formatPct(kpis.lateDeliveryPercent)}
        confirmed={c ? {
          qty: c.lateDeliveryUnits, hash: true, aside: formatItems(c.lateDeliveryItemCount), pct: formatPct(c.lateDeliveryPercent),
        } : null}
        selected={selectedKey === 'lateDelivery'}
        clickable={clickableSet.has('lateDelivery')}
        onActivate={handleActivate}
        config={config}
        dateMode={dateMode}
      />
      <KpiCard
        kpiKey="onTime"
        label="On time delivery"
        qty={kpis.onTimeUnits}
        hash
        aside={formatItems(kpis.onTimeItemCount)}
        pct={formatPct(kpis.onTimePercent)}
        confirmed={c ? {
          qty: c.onTimeUnits, hash: true, aside: formatItems(c.onTimeItemCount), pct: formatPct(c.onTimePercent),
        } : null}
        selected={selectedKey === 'onTime'}
        clickable={clickableSet.has('onTime')}
        onActivate={handleActivate}
        config={config}
        dateMode={dateMode}
      />
      <KpiCard
        kpiKey="openLate"
        label="Open and late"
        qty={kpis.openLateUnits}
        hash
        aside={formatItems(kpis.openLateItemCount)}
        detail={formatDays(kpis.openLateAvgDays)}
        confirmed={c ? {
          qty: c.openLateUnits, hash: true, aside: formatItems(c.openLateItemCount), detail: formatDays(c.openLateAvgDays),
        } : null}
        selected={selectedKey === 'openLate'}
        clickable={clickableSet.has('openLate')}
        onActivate={handleActivate}
        config={config}
        dateMode={dateMode}
      />
      <KpiCard
        kpiKey="lateItems"
        label="Average days late"
        qty={kpis.lateDeliveryAvgDays}
        hash="Ø"
        aside="days late"
        confirmed={c ? { qty: c.lateDeliveryAvgDays, hash: 'Ø', aside: 'days late' } : null}
        selected={selectedKey === 'lateItems'}
        clickable={clickableSet.has('lateItems')}
        onActivate={handleActivate}
        config={config}
        dateMode={dateMode}
      />
      <KpiCard
        kpiKey="unconfirmed"
        label="Not confirmed"
        qty={kpis.unconfirmedUnits}
        hash
        aside={formatItems(kpis.unconfirmedItemCount)}
        pct={formatPct(kpis.unconfirmedPercent)}
        confirmed={c ? {
          qty: c.unconfirmedUnits, hash: true, aside: formatItems(c.unconfirmedItemCount), pct: formatPct(c.unconfirmedPercent),
        } : null}
        selected={selectedKey === 'unconfirmed'}
        clickable={clickableSet.has('unconfirmed')}
        onActivate={handleActivate}
        config={config}
        dateMode={dateMode}
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
        dateMode={dateMode}
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
        dateMode={dateMode}
      />
    </div>
    </KpiCardStyleProvider>
  );
}

export default memo(RccpKpiCards);
