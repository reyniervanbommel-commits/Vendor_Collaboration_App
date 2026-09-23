import React, {
  memo, useCallback, useDeferredValue, useEffect, useMemo, useState,
} from 'react';
import {
  Spinner, Text, makeStyles, shorthands, tokens,
} from '@fluentui/react-components';
import RccpChartMatrixPanel from './RccpChartMatrixPanel';
import RccpSplitKpiPanel from './RccpSplitKpiPanel';
import { filterRccpChartBySegments, filterRccpMatrixByItem } from './rccpChartItems';
import { clampRccpChartHeight } from './rccpUtils';
import {
  parseRccpPeriodGrain,
  resolveRccpChartView,
  secondaryRccpPlanningDateMode,
} from './rccpPeriodGrain';
import { resolveRccpItemsFromFilter } from './resolveRccpItemFilter';
import { useRccpSplitAnalysis } from '../../hooks/useRccpSplitAnalysis';

export const RCCP_SPLIT_CHART_HEIGHT = 180;

function ReloadOverlay({ show, className }) {
  if (!show) return null;
  return (
    <div className={className} role="status">
      <Spinner size="small" label="Loading PERF…" />
    </div>
  );
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalS),
    minHeight: 0,
    height: '100%',
    width: '100%',
  },
  bodyRow: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    ...shorthands.gap(tokens.spacingHorizontalM),
  },
  // 'auto' (niet 'hidden'): zodra de grafiek via de resize-handle meer hoogte krijgt, moet de
  // matrix binnen dit vak alsnog scrollbaar blijven in plaats van afgekapt te worden.
  body: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: 'auto',
    position: 'relative',
  },
  reloadOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `color-mix(in srgb, ${tokens.colorNeutralBackground1} 70%, transparent)`,
    zIndex: 1,
    pointerEvents: 'none',
  },
  error: { color: tokens.colorPaletteRedForeground1 },
});

function RccpSplitStrip({
  vendorAccount, refreshKey, enabled, isoWindow, filterByColumn, itemColumnKey, onItemClick,
  planningDateModes, periodGrain: periodGrainProp, orderNumbers, onAnalysisChange,
  kpiPanelOrders, kpiFilterKey, onKpiFilter, kpiRefreshKey,
}) {
  const styles = useStyles();
  const periodGrain = parseRccpPeriodGrain(periodGrainProp);
  // Sessie-only: hoogte van de grafiek t.o.v. de matrix, versleepbaar via de hover-only
  // scheidingslijn tussen beide (RccpChartResizeHandle).
  const [chartHeight, setChartHeight] = useState(RCCP_SPLIT_CHART_HEIGHT);
  const handleChartHeightChange = useCallback((next) => {
    setChartHeight((prev) => {
      const clamped = clampRccpChartHeight(next, prev);
      return clamped === prev ? prev : clamped;
    });
  }, []);

  const {
    analysis, analysisByMode, loading, error, measureRows, periods, chart, chartWeekRanges,
  } = useRccpSplitAnalysis({
    vendorAccount,
    isoWindow,
    enabled,
    refreshKey,
    planningDateModes,
  });

  useEffect(() => {
    onAnalysisChange?.(analysis || null);
  }, [analysis, onAnalysisChange]);
  useEffect(() => () => onAnalysisChange?.(null), [onAnalysisChange]);

  const chartView = useMemo(() => resolveRccpChartView({
    grain: periodGrain,
    periods,
    chart,
    cells: analysis?.cells,
  }), [periodGrain, periods, chart, analysis?.cells]);

  const itemFilter = useMemo(
    () => resolveRccpItemsFromFilter(filterByColumn, undefined, itemColumnKey),
    [filterByColumn, itemColumnKey],
  );
  // Defer the heavy chart/matrix filter so the overlay spinner can paint first.
  // Same work, one frame later — does not add extra fetches or unmount the pane.
  const deferredOrderNumbers = useDeferredValue(orderNumbers);
  const deferredItemFilter = useDeferredValue(itemFilter);
  const filterPending = deferredOrderNumbers !== orderNumbers || deferredItemFilter !== itemFilter;
  const showReloadOverlay = Boolean(analysis && (loading || filterPending));
  const filteredChart = useMemo(
    () => {
      const filterOptions = {
        emptyHidesAll: deferredItemFilter.active || Array.isArray(deferredOrderNumbers),
        orderNumbers: deferredOrderNumbers,
        containsTerm: deferredItemFilter.containsTerm,
        measureRows,
      };
      if (deferredItemFilter.active) filterOptions.items = deferredItemFilter.items;
      return filterRccpChartBySegments(chartView.chart, filterOptions);
    },
    [chartView.chart, deferredItemFilter, deferredOrderNumbers, measureRows],
  );
  const filteredCellMap = useMemo(
    () => filterRccpMatrixByItem(chartView.cellMap, {
      chart: filteredChart,
      measureRows,
      active: deferredItemFilter.active || Array.isArray(deferredOrderNumbers),
    }),
    [chartView.cellMap, filteredChart, measureRows, deferredItemFilter, deferredOrderNumbers],
  );
  // Tweede load-date-serie: dezelfde grain en dezelfde PO-/item-filter op de al geladen
  // analyse van de andere leverdatum.
  const secondaryMode = secondaryRccpPlanningDateMode(planningDateModes);
  const secondaryAnalysis = secondaryMode ? analysisByMode?.[secondaryMode] : null;
  const secondaryChartView = useMemo(
    () => (secondaryAnalysis
      ? resolveRccpChartView({
        grain: periodGrain,
        periods: secondaryAnalysis.periods,
        chart: secondaryAnalysis.chart,
        cells: secondaryAnalysis.cells,
      })
      : null),
    [secondaryAnalysis, periodGrain],
  );
  const secondaryFilteredChart = useMemo(
    () => {
      if (!secondaryChartView) return null;
      const filterOptions = {
        emptyHidesAll: deferredItemFilter.active || Array.isArray(deferredOrderNumbers),
        orderNumbers: deferredOrderNumbers,
        containsTerm: deferredItemFilter.containsTerm,
        measureRows,
      };
      if (deferredItemFilter.active) filterOptions.items = deferredItemFilter.items;
      return filterRccpChartBySegments(secondaryChartView.chart, filterOptions);
    },
    [secondaryChartView, deferredItemFilter, deferredOrderNumbers, measureRows],
  );
  const secondaryFilteredCellMap = useMemo(
    () => (secondaryChartView
      ? filterRccpMatrixByItem(secondaryChartView.cellMap, {
        chart: secondaryFilteredChart,
        measureRows,
        active: deferredItemFilter.active || Array.isArray(deferredOrderNumbers),
      })
      : null),
    [secondaryChartView, secondaryFilteredChart, measureRows, deferredItemFilter, deferredOrderNumbers],
  );

  const focusItem = deferredItemFilter.items.length === 1 ? deferredItemFilter.items[0] : '';
  const itemFocus = useMemo(
    () => ({ item: focusItem, onSelect: onItemClick }),
    [focusItem, onItemClick],
  );

  return (
    <div className={styles.root} aria-busy={loading || filterPending}>
      {loading && !analysis && <Spinner size="tiny" label="Loading PERF…" />}
      {error && <Text className={styles.error}>{error}</Text>}

      {analysis && !error && (
        <div className={styles.bodyRow}>
          <div className={styles.body}>
            <ReloadOverlay show={showReloadOverlay} className={styles.reloadOverlay} />
            <RccpChartMatrixPanel
              chart={filteredChart}
              chartSecondary={secondaryFilteredChart}
              measureRows={measureRows}
              periods={chartView.periods}
              cellMap={filteredCellMap}
              cellMapSecondary={secondaryFilteredCellMap}
              planningDateModes={planningDateModes}
              chartWeekRanges={chartWeekRanges}
              compact
              chartHeight={chartHeight}
              onChartHeightChange={handleChartHeightChange}
              itemFocus={itemFocus}
              matrixColorFill={analysis.config?.matrixColorFill !== false}
              confirmedColor={analysis.config?.confirmedColor}
              showCapacityRows={analysis.config?.showCapacityRows !== false}
            />
          </div>
          <RccpSplitKpiPanel
            kpiKeys={analysis.config?.splitPanelKpiKeys}
            orders={kpiPanelOrders}
            selectedKey={kpiFilterKey}
            onKpiFilter={onKpiFilter}
            refreshKey={kpiRefreshKey}
            planningDateModes={planningDateModes}
          />
        </div>
      )}
    </div>
  );
}

export default memo(RccpSplitStrip);
