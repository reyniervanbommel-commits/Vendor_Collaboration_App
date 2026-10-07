import { useCallback, useMemo } from 'react';
import {
  NO_COLOR_FILTER_VALUE,
  getColumnAvailableFilterColors,
  getRowFormatFilterColors,
  normalizeFilterColors,
} from '../components/supplier/columnFilterColorUtils';

/**
 * Levert de state + handlers voor het "filter by color"-blok in het kolommenu.
 *
 * @param {object} params
 * @param {object} params.column - de kolomdefinitie
 * @param {object|undefined} params.filter - het huidige filter voor deze kolom
 * @param {object|null} params.columnFormatRuleSet - conditional-formatting regelset van deze kolom
 * @param {Array} [params.columns] - alle kolommen (voor row-target regels)
 * @param {object} [params.columnFormatRules] - volledige map met format-regelsets
 * @param {(columnKey: string, colors: string[]) => void} params.onSetColumnColorFilter
 * @returns {{ supported: boolean, availableColors: string[], selectedColors: string[],
 *   toggleColor: (color: string) => void, clear: () => void }}
 */
export function usePurchaseOrderColorFilter({
  column,
  filter,
  columnFormatRuleSet,
  columns = [],
  columnFormatRules = {},
  onSetColumnColorFilter,
}) {
  const availableColors = useMemo(() => {
    // Eigen kleuren (status/cell-format) + rij-brede kleuren (row-target regels op
    // welke kolom dan ook), zodat je op elke kolom op een rijkleur kunt filteren.
    const own = getColumnAvailableFilterColors(column, columnFormatRuleSet);
    const rowColors = getRowFormatFilterColors(columns, columnFormatRules);
    const colors = Array.from(new Set([...own, ...rowColors]));
    // Zolang er kleuren zijn, kan er ook op "geen kleur" (lege cellen/rijen) gefilterd worden.
    if (colors.length) colors.push(NO_COLOR_FILTER_VALUE);
    return colors;
  }, [column, columnFormatRuleSet, columns, columnFormatRules]);

  const selectedColors = useMemo(
    () => (Array.isArray(filter?.colors) ? normalizeFilterColors(filter.colors) : []),
    [filter]
  );

  const supported = availableColors.length > 0 && typeof onSetColumnColorFilter === 'function';

  const toggleColor = useCallback((color) => {
    if (typeof onSetColumnColorFilter !== 'function') return;
    const next = new Set(selectedColors);
    if (next.has(color)) next.delete(color);
    else next.add(color);
    onSetColumnColorFilter(column.key, Array.from(next));
  }, [column.key, onSetColumnColorFilter, selectedColors]);

  const clear = useCallback(() => {
    if (typeof onSetColumnColorFilter !== 'function') return;
    onSetColumnColorFilter(column.key, []);
  }, [column.key, onSetColumnColorFilter]);

  return useMemo(
    () => ({ supported, availableColors, selectedColors, toggleColor, clear }),
    [supported, availableColors, selectedColors, toggleColor, clear]
  );
}
