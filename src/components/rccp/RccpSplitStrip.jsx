import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Spinner, Text, makeStyles, shorthands, tokens,
} from '@fluentui/react-components';
import RccpChartMatrixPanel from './RccpChartMatrixPanel';
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

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalS),
    minHeight: 0,
    height: '100%',
    width: '100%',
  },
  // 'auto' (niet 'hidden'): zodra de grafiek via de resize-handle meer hoogte krijgt, moet de
  // matrix binnen dit vak alsnog scrollbaar blijven in plaats van afgekapt te worden.
  body: { flex: 1, minHeight: 0, overflow: 'auto' },
  error: { color: tokens.colorPaletteRedForeground1 },
});

function RccpSplitStrip({
  vendorAccount, refreshKey, enabled, isoWindow, filterByColumn, itemColumnKey, onItemClick,
  planningDateModes, periodGrain: periodGrainProp, orderNumbers, onAnalysisChange,
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
  const filteredChart = useMemo(
    () => {
      const filterOptions = {
        emptyHidesAll: itemFilter.active || Array.isArray(orderNumbers),
        orderNumbers,
        containsTerm: itemFilter.containsTerm,
        measureRows,
      };
      if (itemFilter.active) filterOptions.items = itemFilter.items;
      return filterRccpChartBySegments(chartView.chart, filterOptions);
    },
    [chartView.chart, itemFilter, orderNumbers, measureRows],
  );
  const filteredCellMap = useMemo(
    () => filterRccpMatrixByItem(chartView.cellMap, {
      chart: filteredChart,
      measureRows,
      active: itemFilter.active || Array.isArray(orderNumbers),
    }),
    [chartView.cellMap, filteredChart, measureRows, itemFilter, orderNumbers],
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
        emptyHidesAll: itemFilter.active || Array.isArray(orderNumbers),
        orderNumbers,
        containsTerm: itemFilter.containsTerm,
        measureRows,
      };
      if (itemFilter.active) filterOptions.items = itemFilter.items;
      return filterRccpChartBySegments(secondaryChartView.chart, filterOptions);
    },
    [secondaryChartView, itemFilter, orderNumbers, measureRows],
  );
  const secondaryFilteredCellMap = useMemo(
    () => (secondaryChartView
      ? filterRccpMatrixByItem(secondaryChartView.cellMap, {
        chart: secondaryFilteredChart,
        measureRows,
        active: itemFilter.active || Array.isArray(orderNumbers),
      })
      : null),
    [secondaryChartView, secondaryFilteredChart, measureRows, itemFilter, orderNumbers],
  );

  const focusItem = itemFilter.items.length === 1 ? itemFilter.items[0] : '';
  const itemFocus = useMemo(
    () => ({ item: focusItem, onSelect: onItemClick }),
    [focusItem, onItemClick],
  );

  return (
    <div className={styles.root}>
      {loading && !analysis && <Spinner size="tiny" label="Loading PERF…" />}
      {error && <Text className={styles.error}>{error}</Text>}

      {analysis && !error && (
        <div className={styles.body}>
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
          />
        </div>
      )}
    </div>
  );
}

export default memo(RccpSplitStrip);
