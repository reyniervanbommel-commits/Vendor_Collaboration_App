import React, { memo, useCallback, useMemo } from 'react';
import {
  Badge,
  Button,
  Input,
  Switch,
  Text,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { AddRegular, DeleteRegular, NumberSymbolRegular } from '@fluentui/react-icons';
import SyncFilterRuleRow from './SyncFilterRuleRow';
import FilterPreview from './FilterPreview';
import AdminInfoHint from './AdminInfoHint';
import { DATA_MODEL_INFO } from './dataModelInfoCopy';

const useStyles = makeStyles({
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderRadius('8px'),
    ...shorthands.padding('12px', '14px'),
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('8px'),
  },
  header: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), flexWrap: 'wrap' },
  nameInput: { width: '220px', minWidth: '160px' },
  actions: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), flexWrap: 'wrap' },
  hint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

/**
 * Eén sync-filter-LAAG (werkitem #325): naam, actief-toggle, eigen regel-editor en count-preview.
 * Lagen worden OR-gecombineerd door de server; regels binnen een laag blijven AND (bestaande
 * SyncFilterRuleRow-UI, ongewijzigd hergebruikt).
 */
function SyncFilterLayerCard({
  layer,
  index,
  hasLineLevel,
  fieldsForLevel,
  canRemove,
  onRename,
  onToggleActive,
  onRemove,
  onAddRule,
  onUpdateRule,
  onRemoveRule,
  onOpenPicker,
  preview,
  count,
  countLoading,
  countError,
  onCountRows,
  styles: sharedStyles,
}) {
  const styles = useStyles();

  const activeRules = useMemo(
    () => layer.rules.filter((r) => r.field && r.value !== '' && r.value !== null && r.value !== undefined),
    [layer.rules]
  );

  const handleUpdate = useCallback((ruleIndex, patch) => onUpdateRule(layer.id, ruleIndex, patch), [layer.id, onUpdateRule]);
  const handleRemove = useCallback((ruleIndex) => onRemoveRule(layer.id, ruleIndex), [layer.id, onRemoveRule]);
  const handleOpenPicker = useCallback((ruleIndex, level) => onOpenPicker(layer.id, ruleIndex, level), [layer.id, onOpenPicker]);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <Switch
          checked={layer.active}
          onChange={() => onToggleActive(layer.id)}
          label={layer.active ? 'Active' : 'Inactive'}
        />
        <Input
          className={styles.nameInput}
          size="small"
          value={layer.name}
          onChange={(e) => onRename(layer.id, e.target.value)}
          aria-label={`Layer ${index + 1} name`}
        />
        <Badge appearance="tint" color={activeRules.length ? 'brand' : 'warning'} size="small">
          {activeRules.length ? `${activeRules.length} rule(s)` : 'No rules'}
        </Badge>
        {canRemove ? (
          <Button
            size="small"
            appearance="subtle"
            icon={<DeleteRegular />}
            onClick={() => onRemove(layer.id)}
            aria-label={`Remove layer ${layer.name}`}
          />
        ) : null}
      </div>

      <div className={styles.actions}>
        <Button size="small" appearance="secondary" icon={<AddRegular />} onClick={() => onAddRule(layer.id)}>
          Add filter
        </Button>
        <Button
          size="small"
          appearance="secondary"
          icon={<NumberSymbolRegular />}
          onClick={() => onCountRows(layer.id)}
          disabled={countLoading}
        >
          {countLoading ? 'Counting...' : 'Count rows'}
        </Button>
        <AdminInfoHint text={DATA_MODEL_INFO.countRows} label="About count rows" />
        {count !== null && count !== undefined ? (
          <Badge appearance="tint" color="brand">
            Query rows in D365: {count.toLocaleString('nl-NL')}
          </Badge>
        ) : null}
        {countError ? <Text className={styles.hint}>{countError}</Text> : null}
      </div>

      {layer.rules.map((rule, ruleIndex) => (
        <SyncFilterRuleRow
          key={ruleIndex}
          rule={{ ...rule, availableFieldCount: fieldsForLevel(rule.level || 'header').length }}
          index={ruleIndex}
          hasLineLevel={hasLineLevel}
          onUpdate={handleUpdate}
          onRemove={handleRemove}
          onOpenPicker={handleOpenPicker}
          styles={sharedStyles}
        />
      ))}

      <FilterPreview label={`"${layer.name}" $filter`} value={preview} />
    </div>
  );
}

export default memo(SyncFilterLayerCard);
