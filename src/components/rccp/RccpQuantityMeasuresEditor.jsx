import React, { memo, useCallback, useMemo } from 'react';
import { Text, makeStyles, shorthands, tokens } from '@fluentui/react-components';
import { isRccpQuantityColumn, SLOT_DEFAULT_KEYS } from '../../utils/rccpQuantityColumns';
import RccpQuantityMeasureCard from './RccpQuantityMeasureCard';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalM),
    width: '100%',
  },
  hint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

const SLOTS = [
  { title: 'Open', field: 'openMeasureKey', fallback: SLOT_DEFAULT_KEYS.open },
  { title: 'Received', field: 'deliveredMeasureKey', fallback: SLOT_DEFAULT_KEYS.received },
  { title: 'Ordered', field: 'orderedMeasureKey', fallback: SLOT_DEFAULT_KEYS.ordered },
];

function RccpQuantityMeasuresEditor({
  measures, columns, hideIntro, openMeasureKey, deliveredMeasureKey, orderedMeasureKey, onChange, onUpdateField,
}) {
  const styles = useStyles();
  const numberCols = useMemo(
    () => columns.filter(isRccpQuantityColumn),
    [columns],
  );

  const slotMeasures = useMemo(
    () => SLOTS.map((slot, index) => {
      const key = [openMeasureKey, deliveredMeasureKey, orderedMeasureKey][index] || slot.fallback;
      return measures.find((m) => m.columnKey === key) || {
        columnKey: key,
        label: key,
        chartType: 'line',
        color: '#D13438',
        showInChart: true,
      };
    }),
    [measures, openMeasureKey, deliveredMeasureKey, orderedMeasureKey],
  );

  const updateMeasure = useCallback((index, patch) => {
    const next = slotMeasures.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
    onChange(next);
    if (patch.columnKey) onUpdateField(SLOTS[index].field, patch.columnKey);
  }, [slotMeasures, onChange, onUpdateField]);

  return (
    <div className={styles.root}>
      {!hideIntro && (
        <Text className={styles.hint}>
          Each slot maps one numeric column. Open and Received drive the chart boxes (open in
          full color, already-received in a faded received color); Ordered is a matrix row only.
        </Text>
      )}
      {!numberCols.length && (
        <Text className={styles.hint}>
          No numeric columns found. Add a number column or a formula on the order header.
        </Text>
      )}
      {slotMeasures.map((measure, index) => (
        <RccpQuantityMeasureCard
          key={SLOTS[index].field}
          measure={measure}
          index={index}
          numberCols={numberCols}
          slotTitle={SLOTS[index].title}
          showChartType={index === 2}
          showColor={index !== 2}
          onUpdate={updateMeasure}
        />
      ))}
    </div>
  );
}

export default memo(RccpQuantityMeasuresEditor);
