import React, { memo, useMemo } from 'react';
import { Text, makeStyles, shorthands, tokens } from '@fluentui/react-components';
import RccpMatrixTable from './RccpMatrixTable';
import { RccpPoSegmentHoverCard } from './RccpPoSegmentTooltip';
import RccpChartPlot from './RccpChartPlot';
import { RccpSegmentHoverContext } from './RccpPoStackBar';
import {
  RCCP_CHART_Y_AXIS_WIDTH,
  RCCP_ROW_LABEL_WIDTH,
} from './rccpUtils';
import RccpLinkedHScroll from './RccpLinkedHScroll';
import RccpChartLegend from './RccpChartLegend';
import RccpChartResizeHandle from './RccpChartResizeHandle';
import RccpStickyChartYAxis from './RccpStickyChartYAxis';
import { rccpChartFlashSignature } from './rccpChartFlash';
import { useRccpChartFlash } from './useRccpChartFlash';
import { useRccpChartRowsLayout } from '../../hooks/useRccpChartRowsLayout';
import { useRccpChartVisibility } from '../../hooks/useRccpChartVisibility';
import { useRccpChartHoverSegment } from '../../hooks/useRccpChartHoverSegment';
import { useRccpChartSeriesData } from '../../hooks/useRccpChartSeriesData';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0 },
  chartCard: {
    ...shorthands.padding(tokens.spacingVerticalM, tokens.spacingHorizontalL, '0'),
    minHeight: '240px',
    overflow: 'visible',
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow4,
  },
  chartCardCompact: {
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM, '0'),
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow4,
  },
  chartArea: { flex: 1, minHeight: 0 },
  chartHeader: {
    ...shorthands.padding(0, 0, tokens.spacingVerticalS),
  },
});

function RccpChartMatrixPanel({
  chart,
  chartSecondary = null,
  measureRows,
  periods,
  cellMap,
  cellMapSecondary = null,
  planningDateModes = null,
  chartWeekRanges = [],
  compact = false,
  chartHeight = 240,
  onChartHeightChange = null,
  onCellClick,
  interactive = false,
  visibility = null,
  itemFocus = null,
  matrixColorFill = true,
  confirmedColor = null,
}) {
  const styles = useStyles();
  const {
    orderedRows, matrixRows, periodHeaders, gridWidth, chartWidth,
    weekBoundaryCoordinates, chartRangeBands,
  } = useRccpChartRowsLayout({ measureRows, periods, chartWeekRanges });
  const { visibleKeys, handleToggle } = useRccpChartVisibility({ orderedRows, visibility });
  const {
    hoveredSegment, hoverBoxRef, hoverValue, fallbackDataAreaId,
  } = useRccpChartHoverSegment({ chart, itemFocus });
  const {
    plot, stack, legendItems, seriesSignature, todayMarker, yAxis,
  } = useRccpChartSeriesData({
    orderedRows, visibleKeys, chart, chartSecondary, planningDateModes, compact, chartHeight,
    chartWidth, weekBoundaryCoordinates, chartRangeBands, periodHeaders, confirmedColor,
  });

  const flashSignature = useMemo(
    () => `${rccpChartFlashSignature(chart)}|${seriesSignature}`,
    [chart, seriesSignature],
  );
  const flashRef = useRccpChartFlash(flashSignature);

  if (!periodHeaders.length) return null;

  const alignedContent = (
    <RccpLinkedHScroll
      contentWidth={gridWidth}
      top={(
        <div
          ref={flashRef}
        >
          <RccpStickyChartYAxis
            height={yAxis.plotHeight}
            compact={compact}
            yDomain={yAxis.domain}
            dragHandlers={yAxis.dragHandlers}
            isDragging={yAxis.isDragging}
            isScaled={yAxis.isScaled}
            zoomPercent={yAxis.zoomPercent}
          />
          <div style={{ marginLeft: RCCP_ROW_LABEL_WIDTH - RCCP_CHART_Y_AXIS_WIDTH }}>
            <div key={seriesSignature}>
              <RccpSegmentHoverContext.Provider value={hoverValue}>
                <RccpChartPlot
                  plot={plot}
                  stack={stack}
                  todayMarker={todayMarker}
                />
              </RccpSegmentHoverContext.Provider>
              <RccpPoSegmentHoverCard
                hover={hoveredSegment}
                boxRef={hoverBoxRef}
                fallbackDataAreaId={fallbackDataAreaId}
              />
            </div>
          </div>
        </div>
      )}
      middle={(
        <>
          <RccpChartLegend items={legendItems} compact={compact} />
          {onChartHeightChange ? (
            <RccpChartResizeHandle height={chartHeight} onResize={onChartHeightChange} />
          ) : null}
        </>
      )}
      bottom={(
        <RccpMatrixTable
          measureRows={matrixRows}
          periods={periods}
          cellMap={cellMap}
          cellMapSecondary={stack.dual ? cellMapSecondary : null}
          planningDateModes={planningDateModes}
          visibleKeys={visibleKeys}
          onToggleVisible={handleToggle}
          onCellClick={onCellClick}
          interactive={interactive}
          gridWidth={gridWidth}
          kpiHighlight={visibility?.kpiHighlight}
          colorFillEnabled={matrixColorFill}
        />
      )}
    />
  );

  return (
    <div className={styles.root}>
      <div className={compact ? styles.chartCardCompact : styles.chartCard}>
        {!compact && (
          <div className={styles.chartHeader}>
            <Text weight="semibold">Capacity vs load</Text>
          </div>
        )}
        {compact ? <div className={styles.chartArea}>{alignedContent}</div> : alignedContent}
      </div>
    </div>
  );
}

export default memo(RccpChartMatrixPanel);
