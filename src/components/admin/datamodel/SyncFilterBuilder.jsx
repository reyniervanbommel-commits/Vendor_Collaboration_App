import React, { memo, useCallback, useState } from 'react';
import {
  Badge,
  Button,
  Dropdown,
  Option,
  Text,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { AddRegular, SaveRegular, FilterRegular } from '@fluentui/react-icons';
import { useSyncFilterLayers } from '../../../hooks/useSyncFilterLayers';
import { ENUM_FIELDS } from '../../../hooks/useSyncFilters';
import FilterFieldPickerDialog from './FilterFieldPickerDialog';
import FilterPreview from './FilterPreview';
import SyncFilterLayerCard from './SyncFilterLayerCard';
import AdminInfoHint from './AdminInfoHint';
import { DATA_MODEL_INFO } from './dataModelInfoCopy';

const useStyles = makeStyles({
  section: {
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.borderRadius('8px'),
    ...shorthands.padding('14px', '16px'),
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('10px'),
  },
  titleRow: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), flexWrap: 'wrap' },
  hint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  ruleRow: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
    flexWrap: 'wrap',
    ...shorthands.padding('4px', '0'),
  },
  levelDropdown: { width: '170px', minWidth: '170px' },
  operatorDropdown: { width: '170px', minWidth: '170px' },
  valueInput: { width: '240px', minWidth: '180px', maxWidth: '320px', flex: '0 1 240px' },
  actions: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), flexWrap: 'wrap' },
  error: { color: tokens.colorPaletteRedForeground1, fontSize: tokens.fontSizeBase200 },
  saved: { color: tokens.colorPaletteGreenForeground1, fontSize: tokens.fontSizeBase200 },
  fieldBadge: { minWidth: '220px', maxWidth: '420px', flex: '1 1 260px' },
  templateDropdown: { width: '200px', minWidth: '180px' },
  layers: { display: 'flex', flexDirection: 'column', ...shorthands.gap('10px') },
});

// Nulmeting-knop: haalt alles opnieuw op zonder het als wijzigingen te loggen. Los van "Sync now"
// omdat het de wijzigingshistorie bewust overslaat — bedoeld na een datamodel-wijziging.
function ReimportBaselineButton({ onReimportBaseline, busy }) {
  if (!onReimportBaseline) return null;
  return (
    <>
      <Button size="small" appearance="secondary" onClick={onReimportBaseline} disabled={busy}>
        {busy ? 'Re-importing...' : 'Re-import (baseline)'}
      </Button>
      <AdminInfoHint text={DATA_MODEL_INFO.reimportBaseline} label="About re-import baseline" />
    </>
  );
}

function SyncFilterBuilder({ tableKey = 'purchase-orders', filterCatalog, syncFilter, cache, onReimportBaseline, baselineBusy = false }) {
  const styles = useStyles();
  const [pickerState, setPickerState] = useState({ open: false, layerId: null, index: null, level: null });
  // Read-only leunt op de server (syncFilter.readOnly). vendors/product-receipt-lines blijven
  // altijd inherited; items is bewerkbaar maar blijft binnen de PO lookup scope.
  const isReadOnly = Boolean(syncFilter?.readOnly)
    || tableKey === 'vendors' || tableKey === 'product-receipt-lines';
  const readOnlyMessage = String(syncFilter?.message || '').trim();
  const inheritedCompiled = String(syncFilter?.inheritedCompiled || '').trim();
  const poScopeHint = String(syncFilter?.poScopeHint || '').trim();
  // Master-only tabellen (bv. items op ReleasedProductsV2) hebben geen regel-niveau.
  const hasLineLevel = (filterCatalog?.line?.length || 0) > 0;
  const {
    layers, addLayer, addTemplateLayer, removeLayer, renameLayer, toggleLayerActive,
    addRule, updateRule, removeRule, previewFor, countLayer, countByLayerId,
    countLoadingByLayerId, countErrorByLayerId, save, saving, error, savedAt, canAddLayer,
  } = useSyncFilterLayers(syncFilter, tableKey);

  const templates = syncFilter?.templates || [];
  const retainedRows = Number(cache?.retainedRows) || 0;
  const retainedMaxAuto = Number(cache?.retainedMaxAuto) || 2000;
  const retentionHint = retainedRows > 0
    ? `${retainedRows} orders are retained outside the current sync filter layers and will be refreshed individually.`
    : `Orders that leave every active layer stay on the board and are refreshed individually (up to ${retainedMaxAuto.toLocaleString('en-US')}). Change the cap on the OData tab.`;

  const fieldsForLevel = useCallback(
    (level) => (level === 'line' ? (filterCatalog?.line || []) : (filterCatalog?.header || [])),
    [filterCatalog]
  );
  const openPicker = useCallback((layerId, index, level) => {
    const safeLevel = level === 'line' ? 'line' : 'header';
    setPickerState({ open: true, layerId, index, level: safeLevel });
  }, []);
  const closePicker = useCallback(() => setPickerState({ open: false, layerId: null, index: null, level: null }), []);
  const pickerLevel = pickerState.level || 'header';
  const pickerFields = fieldsForLevel(pickerLevel);

  const handlePickField = useCallback((field, operator) => {
    if (pickerState.index === null || !pickerState.layerId) return;
    updateRule(pickerState.layerId, pickerState.index, {
      field: field.field,
      label: field.label,
      valueType: field.valueType || 'text',
      // enumType komt uit de centrale registry per veld (niet hardcoded), zodat bv. ProductType
      // de EcoResProductType-namespace krijgt en niet abusievelijk PurchStatus.
      enumType: field.valueType === 'enum' ? ENUM_FIELDS[field.field]?.enumType : undefined,
      operator,
      value: '',
    });
    closePicker();
  }, [pickerState.index, pickerState.layerId, updateRule, closePicker]);

  if (isReadOnly) {
    return (
      <div className={styles.section}>
        <div className={styles.titleRow}>
          <FilterRegular />
          <Text weight="semibold" size={400}>D365 sync filters</Text>
          <AdminInfoHint text={DATA_MODEL_INFO.syncFilters} label="About D365 sync filters" />
          <Badge appearance="tint" color="informative" size="small">Inherited</Badge>
        </div>
        <Text className={styles.hint} block>
          {readOnlyMessage || 'This table inherits the active Purchase Orders sync filter and cannot be edited separately.'}
        </Text>
        <FilterPreview label="Inherited $filter" value={inheritedCompiled} />
        <div className={styles.actions}>
          <ReimportBaselineButton onReimportBaseline={onReimportBaseline} busy={baselineBusy} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.titleRow}>
        <FilterRegular />
        <Text weight="semibold" size={400}>D365 sync filters</Text>
        <AdminInfoHint text={DATA_MODEL_INFO.syncFilters} label="About D365 sync filters" />
        <Badge appearance="tint" color="brand" size="small">{layers.length} layer(s)</Badge>
      </div>
      <Text className={styles.hint} block>
        Filter layers combine with OR: a row enters the cache as soon as it matches at least one
        active layer. Filters are applied directly in the D365 OData call (headers + subitems).
      </Text>
      {poScopeHint ? <Text className={styles.hint} block>{poScopeHint}</Text> : null}
      {poScopeHint ? <FilterPreview label="Purchase Orders $filter (scope)" value={inheritedCompiled} /> : null}
      {tableKey === 'purchase-orders' ? (
        <div className={styles.titleRow}>
          <Text className={styles.hint}>{retentionHint}</Text>
          <AdminInfoHint text={DATA_MODEL_INFO.retention} label="About retained orders" />
        </div>
      ) : null}

      <div className={styles.actions}>
        <Button size="small" appearance="secondary" icon={<AddRegular />} onClick={addLayer} disabled={!canAddLayer}>
          Add layer
        </Button>
        {!canAddLayer ? <Text className={styles.hint}>Maximum 3 layers</Text> : null}
        <Dropdown
          className={styles.templateDropdown}
          size="small"
          placeholder="Add template as layer"
          onOptionSelect={(_, data) => {
            const template = templates.find((t) => t.id === data.optionValue);
            if (template) addTemplateLayer(template);
          }}
          disabled={!canAddLayer}
        >
          {templates.map((template) => (
            <Option key={template.id} value={template.id} text={template.label}>{template.label}</Option>
          ))}
        </Dropdown>
        <ReimportBaselineButton onReimportBaseline={onReimportBaseline} busy={baselineBusy} />
      </div>

      <div className={styles.layers}>
        {layers.map((layer, index) => (
          <SyncFilterLayerCard
            key={layer.id}
            layer={layer}
            index={index}
            hasLineLevel={hasLineLevel}
            fieldsForLevel={fieldsForLevel}
            canRemove={layers.length > 1}
            onRename={renameLayer}
            onToggleActive={toggleLayerActive}
            onRemove={removeLayer}
            onAddRule={addRule}
            onUpdateRule={updateRule}
            onRemoveRule={removeRule}
            onOpenPicker={openPicker}
            preview={previewFor(layer.id)}
            count={countByLayerId[layer.id]}
            countLoading={Boolean(countLoadingByLayerId[layer.id])}
            countError={countErrorByLayerId[layer.id]}
            onCountRows={countLayer}
            styles={styles}
          />
        ))}
      </div>

      <div className={styles.actions}>
        <Button appearance="primary" icon={<SaveRegular />} onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save filters'}
        </Button>
        <AdminInfoHint text={DATA_MODEL_INFO.saveFilters} label="About save filters" />
        {error ? <Text className={styles.error}>{error}</Text> : null}
        {savedAt ? <Text className={styles.saved}>Saved. Next sync uses these layers.</Text> : null}
      </div>

      <FilterFieldPickerDialog
        open={pickerState.open}
        level={pickerLevel}
        fields={pickerFields}
        onClose={closePicker}
        onSelect={handlePickField}
      />
    </div>
  );
}

export default memo(SyncFilterBuilder);
