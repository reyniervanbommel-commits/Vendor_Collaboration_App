import React, { memo, useCallback, useMemo } from 'react';
import {
  Field, Input, Select, Switch, Text, makeStyles, shorthands, tokens,
} from '@fluentui/react-components';
import ColorPalettePicker, { SELECTABLE_STATUS_COLORS } from '../shared/ColorPalettePicker';
import { rccpFieldLabel } from './rccpFieldLabel';
import RccpNarrowDropdown from './RccpNarrowDropdown';
import { buildRccpColumnOption, matchRccpColumn, rccpColumnOptionValue } from '../../utils/rccpColumnGroups';

const CHART_TYPES = [
  { value: 'line', label: 'Line' },
  { value: 'bar', label: 'Bar' },
];

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalS),
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    backgroundColor: tokens.colorNeutralBackground1,
    width: 'max-content',
    maxWidth: '100%',
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shorthands.gap(tokens.spacingHorizontalS),
  },
  title: { minWidth: 0 },
  row: {
    display: 'grid',
    gridTemplateColumns: '120px max-content max-content',
    justifyContent: 'start',
    alignItems: 'end',
    ...shorthands.gap(tokens.spacingHorizontalM),
  },
  field: { width: '200px', maxWidth: '200px' },
  chartSlot: { width: '120px', minWidth: '120px', maxWidth: '120px' },
  colorSlot: { width: 'max-content' },
  colorField: { display: 'flex', alignItems: 'flex-end', minHeight: '32px' },
});

function RccpQuantityMeasureCard({
  measure, index, numberCols, slotTitle, showChartType, showColor = true, onUpdate,
}) {
  const styles = useStyles();
  const matched = matchRccpColumn(numberCols, measure.columnKey);
  const isUnavailable = Boolean(measure.columnKey) && !matched;
  const option = matched ? buildRccpColumnOption(matched) : null;
  const columnLabel = option?.shortText || measure.label || measure.columnKey;
  const selectedValue = matched ? rccpColumnOptionValue(matched) : measure.columnKey;

  const columnOptions = useMemo(() => {
    const list = [];
    if (isUnavailable) {
      list.push({ value: measure.columnKey, text: `${columnLabel} — unavailable` });
    }
    numberCols.forEach((col) => list.push(buildRccpColumnOption(col)));
    return list;
  }, [isUnavailable, measure.columnKey, columnLabel, numberCols]);

  const handleColumn = useCallback((key) => {
    const col = matchRccpColumn(numberCols, key);
    onUpdate(index, { columnKey: key, label: col?.label || key });
  }, [index, numberCols, onUpdate]);

  const handleLabel = useCallback((_, data) => {
    onUpdate(index, { label: data.value });
  }, [index, onUpdate]);

  const handleChart = useCallback((e) => {
    onUpdate(index, { chartType: e.target.value });
  }, [index, onUpdate]);

  const handleColor = useCallback((color) => {
    onUpdate(index, { color });
  }, [index, onUpdate]);

  const handleInChart = useCallback((_, data) => {
    onUpdate(index, { showInChart: data.checked });
  }, [index, onUpdate]);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <Text weight="semibold" className={styles.title}>{slotTitle}</Text>
      </div>
      <div className={styles.field}>
        <Field
          label="Column"
          validationState={isUnavailable ? 'warning' : 'none'}
          validationMessage={isUnavailable ? 'This column has no value in RCCP. Pick another one.' : undefined}
        >
          <RccpNarrowDropdown
            selectedValue={selectedValue}
            selectedText={columnLabel}
            options={columnOptions}
            onSelect={handleColumn}
          />
        </Field>
      </div>
      <div className={styles.field}>
        <Field
          label={rccpFieldLabel(
            'Label',
            'Name shown in the chart legend and as the matrix row name.',
          )}
        >
          <Input
            size="small"
            value={measure.label || ''}
            onChange={handleLabel}
            placeholder={measure.columnKey}
            aria-label={`${slotTitle} chart label`}
          />
        </Field>
      </div>
      <div className={styles.row}>
        {showChartType && (
          <div className={styles.chartSlot}>
            <Field label="Chart type">
              <Select size="small" value={measure.chartType || 'line'} onChange={handleChart}>
                {CHART_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
          </div>
        )}
        {showColor && (
          <div className={styles.colorSlot}>
            <Field label="Color">
              <div className={styles.colorField}>
                <ColorPalettePicker
                  layout="popover"
                  selectedColor={measure.color || SELECTABLE_STATUS_COLORS[0]}
                  onSelect={handleColor}
                  ariaLabel={`${slotTitle} color`}
                />
              </div>
            </Field>
          </div>
        )}
        <Switch
          checked={measure.showInChart !== false}
          onChange={handleInChart}
          label="In chart"
        />
      </div>
    </div>
  );
}

export default memo(RccpQuantityMeasureCard);
