import React, { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import DataPreviewColumnConfigRow from './DataPreviewColumnConfigRow';
import { DATA_MODEL_INFO } from './dataModelInfoCopy';
import {
  BULK_TOGGLE_CONFIG,
  DATA_TYPE_LABELS,
  columnMatchesFilter,
  createSampleByField,
  getExampleRowValues,
  lookupSampleValue,
  sortFlaggedFirst,
  toExcelCellValue,
} from './entityConfigTableUtils';
import DataModelCollapsibleSection from './DataModelCollapsibleSection';
import EntityConfigBulkToggleHeader from './EntityConfigBulkToggleHeader';

const useStyles = makeStyles({
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  tableWrap: {
    width: '100%',
    overflowX: 'auto',
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderRadius('6px'),
  },
  table: { minWidth: '1220px' },
  headerCell: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    backgroundColor: tokens.colorNeutralBackground2,
    whiteSpace: 'nowrap',
    ...shorthands.padding('8px', '12px'),
  },
  valueCell: {
    whiteSpace: 'nowrap',
    fontSize: tokens.fontSizeBase200,
    maxWidth: '240px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    ...shorthands.padding('6px', '12px'),
  },
  filterInput: { maxWidth: '420px' },
  exportButton: { marginLeft: 'auto' },
});

export default function EntityConfigTable({
  title,
  entityName,
  columns,
  preview,
  exportSheetName,
  exportFileName,
  relationFields,
  relationHint = '',
  relationBadgeLabel = 'Header-Line link key',
  togglingKey,
  onToggleVisibility,
  onToggleVisibleAtDelete,
  onToggleWriteback,
  onToggleVendorEditable,
  onDeleteColumn,
  onExportExcel,
  onSetColumnToggleState,
  collapsible = false,
}) {
  const styles = useStyles();
  const visibleCount = columns.filter((item) => item.isActive).length;
  const sampledRows = preview?.sampledRows || 0;
  const sampleByField = useMemo(() => createSampleByField(preview), [preview]);
  const [columnFilter, setColumnFilter] = useState('');
  const handleColumnFilter = useCallback((_, data) => setColumnFilter(data.value), []);
  const filteredColumns = useMemo(() => {
    const matched = columns.filter((column) => {
      const sampleValue = lookupSampleValue(sampleByField, column.d365Field, column.key, column.label);
      return columnMatchesFilter(column, columnFilter, sampleValue);
    });
    return sortFlaggedFirst(matched, (column) => column.isActive);
  }, [columns, sampleByField, columnFilter]);
  const exportColumnNames = useMemo(
    () => columns.map((column) => column.label || column.d365Field),
    [columns],
  );
  const exportD365Fields = useMemo(
    () => columns.map((column) => column.d365Field),
    [columns],
  );
  const handleExport = useCallback(() => {
    const previewRows = preview?.rows || [];
    const exampleRow = getExampleRowValues(previewRows, exportD365Fields, sampleByField);
    const rowValues = exportD365Fields.map((field) => toExcelCellValue(exampleRow[field]));
    onExportExcel({
      sheetName: exportSheetName,
      fileName: exportFileName,
      columnNames: exportColumnNames,
      rowValues,
    });
  }, [preview, exportD365Fields, sampleByField, exportColumnNames, onExportExcel, exportSheetName, exportFileName]);
  const hasRunningToggle = Boolean(togglingKey);
  const bulkToggleActions = useMemo(() => BULK_TOGGLE_CONFIG.map((config) => {
    const eligibleColumns = filteredColumns.filter(config.isEligible);
    const hasEligibleColumns = eligibleColumns.length > 0;
    const everyEligibleEnabled = hasEligibleColumns && eligibleColumns.every(config.isEnabled);
    const everyEligibleDisabled = hasEligibleColumns && eligibleColumns.every((column) => !config.isEnabled(column));
    return {
      ...config,
      affectedCount: eligibleColumns.length,
      onEnable: () => onSetColumnToggleState({
        columns: filteredColumns,
        toggleType: config.key,
        enabled: true,
      }),
      onDisable: () => onSetColumnToggleState({
        columns: filteredColumns,
        toggleType: config.key,
        enabled: false,
      }),
      disableEnable: hasRunningToggle || !hasEligibleColumns || everyEligibleEnabled,
      disableDisable: hasRunningToggle || !hasEligibleColumns || everyEligibleDisabled,
    };
  }), [filteredColumns, hasRunningToggle, onSetColumnToggleState]);
  // Lookup per toggle-kolom, zodat de bulkschakelaar in de juiste kolomkop komt.
  const bulkActionByKey = useMemo(() => {
    const map = {};
    for (const action of bulkToggleActions) map[action.key] = action;
    return map;
  }, [bulkToggleActions]);

  const titleExtra = (
    <>
      <span className={styles.mono}>{entityName}</span>
      <Badge appearance="tint" color="brand" size="small">{visibleCount} visible · {columns.length} registered</Badge>
      <Button className={styles.exportButton} appearance="secondary" onClick={handleExport}>
        Export Excel
      </Button>
    </>
  );

  return (
    <DataModelCollapsibleSection title={title} titleExtra={titleExtra} collapsible={collapsible}>
      <Text className={styles.muted}>
        Sample values come from synced rows, or from a live D365 sample when the cache has no value yet
        ({sampledRows.toLocaleString('nl-NL')} cache rows sampled).
      </Text>
      <Input
        className={styles.filterInput}
        value={columnFilter}
        onChange={handleColumnFilter}
        placeholder="Filter columns (name, D365 field, type, sample value)"
      />
      <Text className={styles.muted}>
        Bulk toggle (in the column headers) applies only to the currently filtered columns.
      </Text>
      <div className={styles.tableWrap}>
        <Table size="small" className={styles.table}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell className={styles.headerCell}>Relation key</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell}>Column</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell}>D365 field</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell}>Type</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell}>Sample value</TableHeaderCell>
              <EntityConfigBulkToggleHeader
                label="Visible in table"
                info={DATA_MODEL_INFO.visibleInTable}
                action={bulkActionByKey.visibility}
                className={styles.headerCell}
              />
              <EntityConfigBulkToggleHeader
                label="Visible at delete"
                info={DATA_MODEL_INFO.visibleAtDelete}
                action={bulkActionByKey.visibleAtDelete}
                className={styles.headerCell}
              />
              <EntityConfigBulkToggleHeader
                label="Write-back to D365"
                info={DATA_MODEL_INFO.writeBack}
                action={bulkActionByKey.writeback}
                className={styles.headerCell}
              />
              <EntityConfigBulkToggleHeader
                label="Editable by vendor"
                info={DATA_MODEL_INFO.vendorEditable}
                action={bulkActionByKey.vendorEditable}
                className={styles.headerCell}
              />
              <TableHeaderCell className={styles.headerCell}>Delete custom column</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredColumns.map((column) => {
              const fieldKey = String(column.d365Field || '').toLowerCase();
              const isRelationField = relationFields?.has ? relationFields.has(fieldKey) : false;
              const sampleValue = lookupSampleValue(sampleByField, column.d365Field, column.key, column.label);
              return (
                <DataPreviewColumnConfigRow
                  key={column.id}
                  column={column}
                  typeLabel={DATA_TYPE_LABELS[column.dataType] || column.dataType}
                  sampleValue={sampleValue}
                  isRelationField={isRelationField}
                  relationBadgeLabel={relationBadgeLabel}
                  togglingKey={togglingKey}
                  onToggleVisibility={onToggleVisibility}
                  onToggleVisibleAtDelete={onToggleVisibleAtDelete}
                  onToggleWriteback={onToggleWriteback}
                  onToggleVendorEditable={onToggleVendorEditable}
                  onDeleteColumn={onDeleteColumn}
                />
              );
            })}
            {!filteredColumns.length ? (
              <TableRow>
                <TableCell className={styles.valueCell} colSpan={10}>No columns match the active filter</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      {relationHint ? <Text className={styles.muted}>{relationHint}</Text> : null}
    </DataModelCollapsibleSection>
  );
}
