import React, { memo, useMemo } from 'react';
import { Spinner, Text, makeStyles, tokens } from '@fluentui/react-components';
import { resolveRccpDashboardKpis, shouldOfferRccpDataWindow } from './rccpUtils';
import { RCCP_CLICKABLE_KPI_KEYS, filterRccpChartByKpi } from './rccpKpiChartFilter';
import { primaryRccpPlanningDateMode } from './rccpPeriodGrain';
import { useRccpKpiFilter } from './useRccpKpiFilter';
import RccpKpiCards from './RccpKpiCards';
import RccpChartMatrixPanel from './RccpChartMatrixPanel';
import RccpEmptyWindowCard from './RccpEmptyWindowCard';
import RccpMissingDateCard from './RccpMissingDateCard';
import RccpDiagnosticsCard from './RccpDiagnosticsCard';

const useStyles = makeStyles({
  error: { color: tokens.colorPaletteRedForeground1 },
});

function RccpDashboardCharts({
  loading, error, analysis, kpiWindowOnly, chart, chartSecondary = null, matrix,
  visibility, interactive, onCellClick, onShowDataWindow, planningDateModes = null,
}) {
  const styles = useStyles();
  const { selectedKey, onSelect, filteredChart, highlight } = useRccpKpiFilter(
    chart,
    matrix?.measureRows,
  );
  const filteredChartSecondary = useMemo(
    () => (chartSecondary ? filterRccpChartByKpi(chartSecondary, selectedKey) : null),
    [chartSecondary, selectedKey],
  );
  // Tegel-waarden volgen alleen de vaste dashboard-KPI's (venster/vendor-filter) — klikken op
  // een tegel filtert de chart/matrix-highlight maar verandert de tegel-waardes niet meer.
  const kpis = resolveRccpDashboardKpis(analysis, kpiWindowOnly);
  const kpisConfirmed = kpiWindowOnly
    ? (analysis?.kpisConfirmed || null)
    : (analysis?.kpisAllConfirmed || analysis?.kpisConfirmed || null);
  // De KPI-tegels volgen de bestaande "load date"-toggle (Req./Conf.) van deze pagina —
  // met beide aan tonen de tegels requested (primaryRccpPlanningDateMode's standaardvolgorde).
  const kpiDateMode = primaryRccpPlanningDateMode(planningDateModes);
  const chartVisibility = useMemo(
    () => ({ ...(visibility || {}), kpiHighlight: highlight }),
    [visibility, highlight],
  );

  if (loading) return <Spinner label="Loading Performance & Planning dashboard..." />;
  if (error) return <Text className={styles.error}>{error}</Text>;
  if (!analysis) return null;

  return (
    <>
      {shouldOfferRccpDataWindow(analysis) && (
        <RccpEmptyWindowCard dataWindow={analysis.dataWindow} onShow={onShowDataWindow} />
      )}
      <RccpKpiCards
        kpis={kpis}
        kpisConfirmed={kpisConfirmed}
        selectedKey={selectedKey || ''}
        onSelect={onSelect}
        clickableKeys={RCCP_CLICKABLE_KPI_KEYS}
        config={analysis.config}
        dateMode={kpiDateMode}
      />
      <RccpChartMatrixPanel
        chart={filteredChart}
        chartSecondary={filteredChartSecondary}
        measureRows={matrix?.measureRows}
        periods={matrix?.periods}
        cellMap={matrix?.cellMap}
        cellMapSecondary={matrix?.cellMapSecondary}
        planningDateModes={planningDateModes}
        chartWeekRanges={analysis.config?.chartWeekRanges}
        onCellClick={onCellClick}
        interactive={interactive}
        visibility={chartVisibility}
        matrixColorFill={analysis.config?.matrixColorFill !== false}
        confirmedColor={analysis.config?.confirmedColor}
      />
      {kpis?.totalOrdered === 0 && (
        <RccpDiagnosticsCard
          diagnostics={analysis.diagnostics}
          config={analysis.config}
          window={analysis.window}
        />
      )}
      <RccpMissingDateCard items={analysis.missingDates} />
    </>
  );
}

export default memo(RccpDashboardCharts);
