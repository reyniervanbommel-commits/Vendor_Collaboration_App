import { useMemo } from 'react';
import { getRgbHex } from '../utils/hexColor';
import {
  todayBand, rccpChartYDomain, rccpLoadDateBarLayout, visibleAboveSegments,
  RCCP_OUTLINE_STROKE_COLOR, RCCP_PO_BAR_SIZE_BELOW,
} from '../components/rccp/rccpPoStack';
import {
  isRccpDualPlanningDate,
  primaryRccpPlanningDateMode,
  secondaryRccpPlanningDateMode,
  RCCP_PLANNING_DATE_CONFIRMED,
} from '../components/rccp/rccpPeriodGrain';
import { rccpChartLegendHeight } from '../components/rccp/rccpUtils';
import { useRccpChartYScale } from './useRccpChartYScale';

function isStackRow(row) {
  return Boolean(row?.isOpen || row?.isDelivered || row?.isOrdered);
}

/**
 * Builds the Recharts-ready `plot`/`stack`/`legendItems` for the capacity/load chart: resolves
 * the open/delivered/ordered colors, the dual load-date bar layout, the manual Y-axis zoom
 * (via useRccpChartYScale) and the remount signature Recharts needs after a label rename.
 *
 * @param {{
 *   orderedRows: Array, visibleKeys: object, chart: Array, chartSecondary?: Array|null,
 *   planningDateModes?: object|string|null, compact?: boolean, chartHeight: number,
 *   chartWidth: number, weekBoundaryCoordinates: Array<number>, chartRangeBands: Array,
 *   periodHeaders: Array,
 * }} input
 * @returns {{
 *   plot: object, stack: object, legendItems: Array, seriesSignature: string,
 *   todayMarker: object,
 *   yAxis: { domain: [number, number], plotHeight: number, isDragging: boolean,
 *            isScaled: boolean, zoomPercent: number, dragHandlers: object },
 * }}
 */
export function useRccpChartSeriesData({
  orderedRows, visibleKeys, chart, chartSecondary = null, planningDateModes = null,
  compact = false, chartHeight, chartWidth, weekBoundaryCoordinates, chartRangeBands, periodHeaders,
  confirmedColor = null,
}) {
  const openRow = useMemo(() => orderedRows.find((row) => row.isOpen), [orderedRows]);
  const deliveredRow = useMemo(() => orderedRows.find((row) => row.isDelivered), [orderedRows]);
  const orderedRow = useMemo(() => orderedRows.find((row) => row.isOrdered), [orderedRows]);
  const receivedColor = useMemo(
    () => getRgbHex(deliveredRow?.color) || '#0078D4',
    [deliveredRow],
  );
  const openColor = useMemo(
    () => getRgbHex(openRow?.color) || receivedColor,
    [openRow, receivedColor],
  );
  const resolvedConfirmedColor = useMemo(
    () => getRgbHex(confirmedColor) || RCCP_OUTLINE_STROKE_COLOR,
    [confirmedColor],
  );
  const openVisible = Boolean(openRow && visibleKeys[openRow.measureKey]);
  const deliveredVisible = Boolean(deliveredRow && visibleKeys[deliveredRow.measureKey]);
  const orderedVisible = Boolean(orderedRow && visibleKeys[orderedRow.measureKey]);

  const activeRows = useMemo(
    () => orderedRows.filter((row) => visibleKeys[row.measureKey] && !isStackRow(row)),
    [orderedRows, visibleKeys],
  );

  // De legenda staat los onder de grafiek (altijd in beeld), dus het plotvlak krijgt de
  // resterende hoogte binnen dezelfde chartHeight.
  const plotHeight = Math.max(60, chartHeight - rccpChartLegendHeight(compact));
  const dual = isRccpDualPlanningDate(planningDateModes);
  const primaryMode = primaryRccpPlanningDateMode(planningDateModes);
  const secondaryMode = secondaryRccpPlanningDateMode(planningDateModes);
  // Confirmed load krijgt zijn eigen kleur (instellingen); requested houdt de open-kleur.
  const colorAbove = primaryMode === RCCP_PLANNING_DATE_CONFIRMED ? resolvedConfirmedColor : openColor;
  const colorAboveAlt = secondaryMode === RCCP_PLANNING_DATE_CONFIRMED ? resolvedConfirmedColor : openColor;
  const barLayout = useMemo(() => rccpLoadDateBarLayout(dual), [dual]);
  const secondaryByKey = useMemo(
    () => new Map((dual ? chartSecondary || [] : []).map((point) => [point.key, point])),
    [dual, chartSecondary],
  );

  const chartRows = useMemo(() => (chart || []).map((point) => {
    const segmentsAbove = visibleAboveSegments(point.segmentsAbove, { openVisible, orderedVisible });
    const segmentsBelow = deliveredVisible ? (point.segmentsBelow || []) : [];
    const alt = secondaryByKey.get(point.key);
    const segmentsAboveAlt = alt
      ? visibleAboveSegments(alt.segmentsAbove, { openVisible, orderedVisible })
      : [];
    return {
      ...point,
      segmentsAbove,
      segmentsBelow,
      segmentsAboveAlt,
      __stackAbove: segmentsAbove.reduce((sum, seg) => sum + seg.qty, 0),
      __stackAboveAlt: segmentsAboveAlt.reduce((sum, seg) => sum + seg.qty, 0),
      __stackBelow: -segmentsBelow.reduce((sum, seg) => sum + seg.qty, 0),
      __openColor: colorAbove,
      __openColorAlt: colorAboveAlt,
      __receivedColor: receivedColor,
      __barWidthAbove: barLayout.barSize,
      // Onder de as staat maar één reeks (received): die houdt altijd een vaste breedte van
      // 65% van de weekkolom, los van de boven-de-as-layout (normaal of dual/smaller).
      __barWidthBelow: RCCP_PO_BAR_SIZE_BELOW,
      __barOffsetAbove: barLayout.primaryOffset,
      __barOffsetAboveAlt: barLayout.secondaryOffset,
    };
  }), [
    chart, secondaryByKey, openVisible, deliveredVisible, orderedVisible,
    colorAbove, colorAboveAlt, receivedColor, barLayout,
  ]);
  const todayMarker = useMemo(() => todayBand(periodHeaders), [periodHeaders]);
  const autoYDomain = useMemo(
    () => rccpChartYDomain(chartRows, activeRows.map((row) => row.measureKey)),
    [chartRows, activeRows],
  );
  // Long-press + drag on the sticky Y-axis lets the user zoom the scale manually; double-click
  // resets to this auto-fit domain. Session-only, never persisted.
  const {
    yDomain, isDragging: yAxisDragging, isScaled: yAxisScaled, zoomPercent: yAxisZoomPercent,
    dragHandlers: yAxisDragHandlers,
  } = useRccpChartYScale(autoYDomain);
  // Labels zitten in de signature: Recharts bouwt zijn legenda bij mount op, dus na het
  // hernoemen van een measure in de instellingen moet de plot opnieuw gemount worden.
  const seriesSignature = useMemo(
    () => [
      activeRows.map((row) => `${row.measureKey}:${row.chartType}:${row.label}`).join('|'),
      openVisible, deliveredVisible, orderedVisible, dual,
      openRow?.label, orderedRow?.label, deliveredRow?.label,
    ].join('|'),
    [
      activeRows, openVisible, deliveredVisible, orderedVisible, dual,
      openRow, orderedRow, deliveredRow,
    ],
  );
  const plot = useMemo(() => ({
    data: chartRows,
    width: chartWidth,
    height: plotHeight,
    compact,
    weekBoundaryCoordinates,
    chartRangeBands,
    activeRows,
    yDomain,
  }), [chartRows, chartWidth, plotHeight, compact, weekBoundaryCoordinates, chartRangeBands, activeRows, yDomain]);
  const loadLabel = openRow?.label || orderedRow?.label || deliveredRow?.label || 'Load';
  const stack = useMemo(() => ({
    openVisible, deliveredVisible, orderedVisible, openRow, orderedRow, deliveredRow, receivedColor,
    dual,
    barSize: barLayout.barSize,
    primaryLabel: dual ? `${loadLabel} (${primaryMode})` : loadLabel,
    secondaryLabel: dual ? `${loadLabel} (${secondaryMode})` : '',
  }), [
    openVisible, deliveredVisible, orderedVisible, openRow, orderedRow, deliveredRow, receivedColor,
    dual, barLayout, loadLabel, primaryMode, secondaryMode,
  ]);
  const legendItems = useMemo(() => {
    const items = [];
    if ((openVisible || orderedVisible) && openRow) {
      items.push({
        key: 'load-primary',
        label: stack.primaryLabel,
        color: colorAbove,
      });
    }
    if (dual && (openVisible || orderedVisible) && openRow) {
      items.push({
        key: 'load-secondary',
        label: stack.secondaryLabel,
        color: colorAboveAlt,
      });
    }
    if (deliveredVisible && deliveredRow) {
      items.push({ key: 'delivered', label: deliveredRow.label, color: receivedColor });
    }
    activeRows.forEach((row) => {
      items.push({
        key: row.measureKey,
        label: row.label,
        color: row.color,
        line: row.chartType !== 'bar',
        dashed: Boolean(row.isDashed),
      });
    });
    return items;
  }, [
    openVisible, orderedVisible, deliveredVisible, dual, openRow, deliveredRow,
    colorAbove, colorAboveAlt, receivedColor, activeRows, stack,
  ]);

  const yAxis = useMemo(() => ({
    domain: yDomain,
    plotHeight,
    isDragging: yAxisDragging,
    isScaled: yAxisScaled,
    zoomPercent: yAxisZoomPercent,
    dragHandlers: yAxisDragHandlers,
  }), [yDomain, plotHeight, yAxisDragging, yAxisScaled, yAxisZoomPercent, yAxisDragHandlers]);

  return { plot, stack, legendItems, seriesSignature, todayMarker, yAxis };
}
