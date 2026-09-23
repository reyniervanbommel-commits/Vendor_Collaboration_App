/**
 * Bepaalt hoeveel kolommen het KPI-tegelpaneel (RccpSplitKpiPanel) gebruikt: zo min mogelijk
 * (bij voorkeur 1), en pas meer zodra de tegels anders niet allemaal in de beschikbare hoogte
 * passen — met een maximum van 3. Bij >1 kolom worden de tegels zo gelijk mogelijk verdeeld
 * (linkerkolommen krijgen bij een oneven aantal de rest), via `grid-auto-flow: column` met
 * een vast aantal rijen.
 *
 * @param {{ tileCount: number, containerHeight: number, tileHeight: number, gap?: number, maxColumns?: number }} input
 * @returns {{ columns: number, rows: number }}
 */
export function resolveSplitPanelKpiColumns({
  tileCount, containerHeight, tileHeight, gap = 0, maxColumns = 3,
}) {
  const count = Math.max(0, Number(tileCount) || 0);
  if (!count) return { columns: 1, rows: 0 };
  // Geen (bruikbare) hoogte gemeten (bv. eerste render vóór de ResizeObserver-meting) —
  // val terug op 1 kolom zodat er nooit een flits van te veel kolommen zichtbaar is.
  const usableHeight = Number(containerHeight) > 0 ? Number(containerHeight) : Infinity;
  const height = Math.max(1, Number(tileHeight) || 1);

  for (let columns = 1; columns < maxColumns; columns += 1) {
    const rows = Math.ceil(count / columns);
    const neededHeight = (rows * height) + (Math.max(0, rows - 1) * gap);
    if (neededHeight <= usableHeight) return { columns, rows };
  }
  const columns = Math.min(maxColumns, count);
  return { columns, rows: Math.ceil(count / columns) };
}
