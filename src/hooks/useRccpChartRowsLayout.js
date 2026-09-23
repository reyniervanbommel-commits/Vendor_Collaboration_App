import { useMemo } from 'react';
import {
  buildMatrixPeriodHeaders,
  buildRccpChartWeekBoundaryCoordinates,
  RCCP_CHART_Y_AXIS_WIDTH,
  RCCP_ROW_LABEL_WIDTH,
  RCCP_WEEK_COL_WIDTH,
  resolveChartWeekRangeBounds,
} from '../components/rccp/rccpUtils';
import { sortRccpMatrixRows } from '../components/rccp/rccpMatrixRows';

/**
 * Derives the row order, period headers and pixel layout shared by the RCCP chart and matrix
 * from the raw measure rows / periods / chart-week-ranges.
 *
 * @param {{ measureRows: Array, periods: Array, chartWeekRanges?: Array, showCapacityRows?: boolean }} input
 * @returns {{
 *   orderedRows: Array, matrixRows: Array, periodHeaders: Array,
 *   gridWidth: number, chartWidth: number,
 *   weekBoundaryCoordinates: Array<number>, chartRangeBands: Array,
 * }}
 */
export function useRccpChartRowsLayout({
  measureRows, periods, chartWeekRanges = [], showCapacityRows = true,
}) {
  const sourceRows = useMemo(
    () => (showCapacityRows
      ? (measureRows || [])
      : (measureRows || []).filter((row) => !row.isCapacity && !row.isOvercapacity)),
    [measureRows, showCapacityRows],
  );
  const orderedRows = useMemo(() => sortRccpMatrixRows(sourceRows), [sourceRows]);
  const matrixRows = useMemo(
    () => orderedRows.filter((row) => !row.isWarning),
    [orderedRows],
  );
  const periodHeaders = useMemo(() => buildMatrixPeriodHeaders(periods), [periods]);
  const gridWidth = useMemo(
    () => (matrixRows.length && periodHeaders.length
      ? RCCP_ROW_LABEL_WIDTH + periodHeaders.length * RCCP_WEEK_COL_WIDTH
      : 0),
    [matrixRows.length, periodHeaders.length],
  );
  const chartRangeBands = useMemo(
    () => (chartWeekRanges || [])
      .map((range) => resolveChartWeekRangeBounds(range, periods))
      .filter(Boolean),
    [chartWeekRanges, periods],
  );
  const chartWidth = useMemo(
    () => RCCP_CHART_Y_AXIS_WIDTH + periodHeaders.length * RCCP_WEEK_COL_WIDTH,
    [periodHeaders.length],
  );
  const weekBoundaryCoordinates = useMemo(
    () => buildRccpChartWeekBoundaryCoordinates(periodHeaders.length),
    [periodHeaders.length],
  );

  return useMemo(() => ({
    orderedRows, matrixRows, periodHeaders, gridWidth, chartWidth,
    weekBoundaryCoordinates, chartRangeBands,
  }), [orderedRows, matrixRows, periodHeaders, gridWidth, chartWidth, weekBoundaryCoordinates, chartRangeBands]);
}
