import React, { memo, useCallback, useState } from 'react';
import {
  Button, Spinner, Tab, TabList, Text, makeStyles, tokens, shorthands,
} from '@fluentui/react-components';
import { Save24Regular } from '@fluentui/react-icons';
import RccpChartWeekRangesEditor from './RccpChartWeekRangesEditor';
import RccpQuantityMeasuresEditor from './RccpQuantityMeasuresEditor';
import RccpSettingsDataFields from './RccpSettingsDataFields';
import RccpSettingsDisplayFields from './RccpSettingsDisplayFields';
import { useRccpSettingsFormHandlers } from './useRccpSettingsFormHandlers';

const TABS = [
  { value: 'data', label: 'Data' },
  { value: 'quantities', label: 'Quantities' },
  { value: 'display', label: 'Display' },
  { value: 'highlights', label: 'Highlights' },
];

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', ...shorthands.gap(tokens.spacingVerticalL) },
  // Wraps the active tab's fields (also the product tour anchor for the settings guide).
  panel: { display: 'flex', flexDirection: 'column', ...shorthands.gap(tokens.spacingVerticalL) },
  hint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  error: { color: tokens.colorPaletteRedForeground1 },
  actions: { display: 'flex', alignItems: 'center', ...shorthands.gap(tokens.spacingHorizontalM), flexWrap: 'wrap' },
});

function RccpSettingsForm({
  variant = 'page', config, columns, itemColumns = [], saving, error, saved, statusOptions,
  onUpdateField, onSave,
}) {
  const styles = useStyles();
  const isFlyout = variant === 'flyout';
  const [tab, setTab] = useState('data');
  const handlers = useRccpSettingsFormHandlers(config, onUpdateField);
  const handleTab = useCallback((_, data) => setTab(data.value), []);

  if (!config) {
    return <Text className={styles.hint}>{error || 'No settings available'}</Text>;
  }

  return (
    <div className={styles.root}>
      {!isFlyout && (
        <Text size={600} weight="semibold">Settings</Text>
      )}
      <TabList selectedValue={tab} onTabSelect={handleTab} size={isFlyout ? 'small' : 'medium'}>
        {TABS.map((entry) => (
          <Tab key={entry.value} value={entry.value} data-tour={`rccp-settings-tab-${entry.value}`}>{entry.label}</Tab>
        ))}
      </TabList>
      <div className={styles.panel} data-tour="rccp-settings-panel">
        {tab === 'data' && (
          <RccpSettingsDataFields
            config={config}
            columns={columns}
            statusOptions={statusOptions}
            compact={isFlyout}
            onUpdateField={onUpdateField}
          />
        )}
        {tab === 'quantities' && (
          <RccpQuantityMeasuresEditor
            measures={config.quantityMeasures || []}
            columns={columns}
            openMeasureKey={config.openMeasureKey}
            deliveredMeasureKey={config.deliveredMeasureKey}
            orderedMeasureKey={config.orderedMeasureKey}
            onChange={handlers.handleMeasures}
            onUpdateField={onUpdateField}
          />
        )}
        {tab === 'display' && (
          <RccpSettingsDisplayFields
            config={config}
            compact={isFlyout}
            itemColumns={itemColumns}
            onUpdateField={onUpdateField}
            onGreen={handlers.handleGreen}
            onOrange={handlers.handleOrange}
            onItemPickerColumns={handlers.handleItemPickerColumns}
          />
        )}
        {tab === 'highlights' && (
          <RccpChartWeekRangesEditor
            ranges={config.chartWeekRanges || []}
            compact={isFlyout}
            onChange={handlers.handleRanges}
          />
        )}
      </div>
      {!isFlyout && (
        <div className={styles.actions}>
          <Button appearance="primary" icon={<Save24Regular />} onClick={onSave} disabled={saving}>
            Save settings
          </Button>
          {saving && <Spinner size="tiny" />}
          {saved && <Text className={styles.hint}>Saved</Text>}
          {error && <Text className={styles.error}>{error}</Text>}
        </div>
      )}
    </div>
  );
}

export default memo(RccpSettingsForm);
