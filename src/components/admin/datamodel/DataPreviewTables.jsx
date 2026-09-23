import React, { memo, useCallback, useMemo } from 'react';
import { Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import { SearchRegular } from '@fluentui/react-icons';
import { exportSingleRowToExcel } from '../../../utils/excelExport';
import EntityConfigTable from './EntityConfigTable';
import AdminInfoHint from './AdminInfoHint';
import { DATA_MODEL_INFO } from './dataModelInfoCopy';

const useStyles = makeStyles({
  discoverRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  discoverHint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

function buildSections({ tableKey, entities, columns, previewTables }) {
  const headerEntity = (entities || []).find((entity) => entity.id === 'header');
  const lineEntity = (entities || []).find((entity) => entity.id === 'line');
  const tableLabel = headerEntity?.title || 'Entity';
  const headerName = headerEntity?.name || 'source';

  if (tableKey === 'purchase-orders' && lineEntity) {
    return [
      {
        scope: 'header',
        title: 'Purchase Order Header columns',
        entityName: headerName,
        columns: columns.header,
        preview: previewTables?.header,
        exportSheetName: 'PurchaseOrderHeaders',
        exportFileName: 'purchase-order-headers-example.xlsx',
        relationHint: 'Yellow-highlighted rows mark the join keys between Purchase Order Headers and Purchase Order Lines.',
        collapsible: true,
      },
      {
        scope: 'line',
        title: 'Purchase Order Line columns',
        entityName: lineEntity.name || 'PurchaseOrderLinesV2',
        columns: columns.line,
        preview: previewTables?.line,
        exportSheetName: 'PurchaseOrderLines',
        exportFileName: 'purchase-order-lines-example.xlsx',
        relationHint: '',
        collapsible: true,
      },
    ];
  }

  if (tableKey === 'product-attribute-values') {
    return [
      {
        scope: 'header',
        title: `${tableLabel} columns`,
        entityName: headerName,
        columns: columns.header,
        preview: previewTables?.header,
        exportSheetName: tableLabel.replace(/\s+/g, '').slice(0, 31) || 'Entity',
        exportFileName: `${tableKey || 'entity'}-example.xlsx`,
        relationHint: 'Yellow row: Product number joins Items (ItemNumber) and purchase-order lines (ItemNumber).',
        relationFields: new Set(['productnumber']),
        relationBadgeLabel: 'Items · ItemNumber',
        collapsible: true,
      },
    ];
  }

  return [
    {
      scope: 'header',
      title: `${tableLabel} columns`,
      entityName: headerName,
      columns: columns.header,
      preview: previewTables?.header,
      exportSheetName: tableLabel.replace(/\s+/g, '').slice(0, 31) || 'Entity',
      exportFileName: `${tableKey || 'entity'}-example.xlsx`,
      relationHint: '',
      collapsible: true,
    },
  ];
}

function DataPreviewTables({
  tableKey = 'purchase-orders',
  entities = [],
  previewTables,
  columns = { header: [], line: [] },
  relation,
  togglingKey,
  onToggleVisibility,
  onToggleVisibleAtDelete,
  onToggleWriteback,
  onToggleVendorEditable,
  onDeleteColumn,
  onSetColumnToggleState,
  onDiscoverFields,
}) {
  const styles = useStyles();
  const handleExportExcel = useCallback(({ sheetName, fileName, columnNames, rowValues }) => {
    exportSingleRowToExcel({
      sheetName,
      fileName,
      columnNames,
      rowValues,
    });
  }, []);
  const relationFields = useMemo(
    () => new Set((relation?.onFields || []).map((field) => String(field).toLowerCase())),
    [relation],
  );
  const sections = useMemo(
    () => buildSections({ tableKey, entities, columns, previewTables }),
    [tableKey, entities, columns, previewTables],
  );

  return (
    <>
      {typeof onDiscoverFields === 'function' ? (
        <div className={styles.discoverRow}>
          <Button
            appearance="secondary"
            icon={<SearchRegular />}
            onClick={onDiscoverFields}
            disabled={togglingKey === 'discover-fields'}
          >
            Discover D365 fields
          </Button>
          <AdminInfoHint text={DATA_MODEL_INFO.discoverFields} label="About discover D365 fields" />
          <Text className={styles.discoverHint}>
            Adds missing D365 columns, hidden until you turn them on.
          </Text>
        </div>
      ) : null}
      {sections.map((section) => (
        <EntityConfigTable
          key={`${tableKey}-${section.scope}`}
          title={section.title}
          entityName={section.entityName}
          columns={section.columns || []}
          preview={section.preview}
          exportSheetName={section.exportSheetName}
          exportFileName={section.exportFileName}
          relationFields={section.relationFields || (section.scope === 'header' ? relationFields : new Set())}
          relationHint={section.relationHint}
          relationBadgeLabel={section.relationBadgeLabel}
          togglingKey={togglingKey}
          onToggleVisibility={onToggleVisibility}
          onToggleVisibleAtDelete={onToggleVisibleAtDelete}
          onToggleWriteback={onToggleWriteback}
          onToggleVendorEditable={onToggleVendorEditable}
          onDeleteColumn={onDeleteColumn}
          onExportExcel={handleExportExcel}
          onSetColumnToggleState={onSetColumnToggleState}
          collapsible={section.collapsible !== false}
        />
      ))}
    </>
  );
}

export default memo(DataPreviewTables);

