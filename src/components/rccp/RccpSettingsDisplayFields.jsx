import React, { memo, useCallback } from 'react';
import { Field, Input, Switch, Text, makeStyles, shorthands, tokens } from '@fluentui/react-components';
import RccpItemPickerColumnsEditor from './RccpItemPickerColumnsEditor';
import { rccpFieldLabel, RccpInfoLabel, RccpHoverHint } from './rccpFieldLabel';
import ColorPalettePicker from '../shared/ColorPalettePicker';

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalXL),
    width: '100%',
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalM),
  },
  groupTitle: { color: tokens.colorNeutralForeground2 },
  pair: {
    display: 'grid',
    gridTemplateColumns: '96px 96px',
    justifyContent: 'start',
    width: 'max-content',
    ...shorthands.gap(tokens.spacingHorizontalM),
  },
  slot: { width: '96px', minWidth: '96px', maxWidth: '96px' },
  switchRow: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap(tokens.spacingHorizontalXS),
  },
});

function ThresholdInputs({ compact, green, orange, onGreen, onOrange }) {
  const styles = useStyles();
  return (
    <div className={styles.pair}>
      <div className={styles.slot}>
        <Field
          label={rccpFieldLabel('Green %', 'Load at or below this percentage is shown as green.')}
        >
          <Input
            size={compact ? 'small' : 'medium'}
            type="number"
            min={0}
            max={100}
            value={String(green)}
            onChange={onGreen}
          />
        </Field>
      </div>
      <div className={styles.slot}>
        <Field
          label={rccpFieldLabel('Orange %', 'Load up to this percentage is orange; above it is red.')}
        >
          <Input
            size={compact ? 'small' : 'medium'}
            type="number"
            min={0}
            max={100}
            value={String(orange)}
            onChange={onOrange}
          />
        </Field>
      </div>
    </div>
  );
}

function ChartOverlaySwitches({ config, onUpdateField }) {
  const styles = useStyles();
  const handleCapacity = useCallback((_, data) => onUpdateField('showCapacityLine', data.checked), [onUpdateField]);
  const handleWarning = useCallback((_, data) => onUpdateField('showWarningLine', data.checked), [onUpdateField]);

  return (
    <>
      <div className={styles.switchRow}>
        <Switch
          checked={config.showCapacityLine !== false}
          onChange={handleCapacity}
          label="Capacity line"
        />
        <RccpHoverHint info="Shows weekly available capacity on the chart." />
      </div>
      <div className={styles.switchRow}>
        <Switch
          checked={config.showWarningLine !== false}
          onChange={handleWarning}
          label="Warning threshold line"
        />
        <RccpHoverHint info="Shows the load warning threshold on the chart." />
      </div>
    </>
  );
}

function ConfirmedColorField({ config, onUpdateField }) {
  const handleChange = useCallback(
    (color) => onUpdateField('confirmedColor', color),
    [onUpdateField],
  );
  return (
    <Field
      label={rccpFieldLabel(
        'Confirmed bar color',
        'Fill color for the confirmed load-date bars in the chart, instead of the outlined bar.',
      )}
    >
      <ColorPalettePicker
        layout="popover"
        selectedColor={config.confirmedColor || '#8A8886'}
        onSelect={handleChange}
        ariaLabel="Confirmed bar color"
      />
    </Field>
  );
}

function MatrixColorFillSwitch({ config, onUpdateField }) {
  const styles = useStyles();
  const handleChange = useCallback(
    (_, data) => onUpdateField('matrixColorFill', data.checked),
    [onUpdateField],
  );
  return (
    <div className={styles.switchRow}>
      <Switch
        checked={config.matrixColorFill !== false}
        onChange={handleChange}
        label="Show colors in matrix"
      />
      <RccpHoverHint info="Colors the whole matrix cell instead of only the number." />
    </div>
  );
}

function RccpSettingsDisplayFields({
  config, compact, itemColumns = [], onUpdateField, onGreen, onOrange, onItemPickerColumns,
}) {
  const styles = useStyles();

  return (
    <div className={styles.stack}>
      <div className={styles.group}>
        <Text weight="semibold" className={styles.groupTitle}>
          <RccpInfoLabel info="Extra item-entity fields shown after the unique item number in the Item dropdown.">
            Item picker
          </RccpInfoLabel>
        </Text>
        <RccpItemPickerColumnsEditor
          columns={itemColumns}
          selectedKeys={config.itemPickerColumnKeys || []}
          compact={compact}
          onChange={onItemPickerColumns}
        />
      </div>
      <div className={styles.group}>
        <Text weight="semibold" className={styles.groupTitle}>
          <RccpInfoLabel info="Show or hide extra lines on the capacity chart.">
            Chart overlays
          </RccpInfoLabel>
        </Text>
        <ChartOverlaySwitches config={config} onUpdateField={onUpdateField} />
        <ConfirmedColorField config={config} onUpdateField={onUpdateField} />
      </div>
      <div className={styles.group}>
        <Text weight="semibold" className={styles.groupTitle}>
          <RccpInfoLabel info="Color bands for capacity load in the matrix.">
            Matrix colors
          </RccpInfoLabel>
        </Text>
        <MatrixColorFillSwitch config={config} onUpdateField={onUpdateField} />
        <ThresholdInputs
          compact={compact}
          green={config.thresholds?.greenMax ?? 80}
          orange={config.thresholds?.orangeMax ?? 100}
          onGreen={onGreen}
          onOrange={onOrange}
        />
      </div>
    </div>
  );
}

export default memo(RccpSettingsDisplayFields);
