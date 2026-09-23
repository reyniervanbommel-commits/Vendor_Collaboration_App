import React, { memo, useCallback } from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import EditableCell from './EditableCell';
import StatusCell from './StatusCell';
import PurchaseOrderWriteBackCell from './PurchaseOrderWriteBackCell';
import PurchaseOrderProductImageCell from './PurchaseOrderProductImageCell';
import PurchaseOrderLinkedHeaderValue from './PurchaseOrderLinkedHeaderValue';
import PurchaseOrderLinkedValueCell from './PurchaseOrderLinkedValueCell';
import { formatCellValue, getJoinedDateValuePreview, isDateLikeCellValue } from '../../utils/purchaseOrderFormat';
import {
  isDatePeriodColumn,
  normalizeDatePeriodDisplayMode,
  resolveDatePeriodCellValue,
} from '../../utils/datePeriodColumnUtils';
import { isProductImageColumn } from '../../utils/purchaseOrderProductImageColumn';
import { isStatusColumn } from '../../utils/statusColumnUtils';
import { FORMATTED_CELL_TEXT_COLOR } from './columnTextStyleUtils';

// Vervangt de oude berekening over order.lines: de board-read levert deze samenvatting mee.
const EMPTY_PRODUCT_IMAGE_SUMMARY = { firstItemNumber: '', additionalItemCount: 0 };

const useStyles = makeStyles({
  removedText: {
    textDecorationLine: 'line-through',
    color: tokens.colorNeutralForeground3,
  },
  formulaError: {
    color: tokens.colorPaletteRedForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  changedCell: {
    backgroundColor: '#fff4ce',
    borderRadius: '4px',
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '24px',
    width: '100%',
    boxSizing: 'border-box',
    paddingLeft: '6px',
    paddingRight: '6px',
  },
});

function PurchaseOrderHeaderCellContent({
  order,
  column,
  actions = {},
  linkedLineTotalMap,
  linkedLineValueMap,
  cellBackgroundColor = '',
  isConditionalFormat = false,
  productImageSummary = EMPTY_PRODUCT_IMAGE_SUMMARY,
  datePeriodDisplayModes = {},
}) {
  const styles = useStyles();
  const key = column.key;
  const rawValue = order.values?.[key];
  const formulaExpr = String(column?.formulaExpr || '').trim();
  const isFormulaColumn = Boolean(formulaExpr);
  const formulaError = isFormulaColumn ? String(order?.formulaErrors?.[key] || '') : '';
  const linkedLineTotalColumnKey = linkedLineTotalMap?.[key] || '';
  const linkedLineValueMeta = linkedLineValueMap?.[key] || null;
  const changedFieldKeys = Array.isArray(order?.changedFieldKeys) ? order.changedFieldKeys : [];
  const isChangedCell = !order?.removedInD365 && !order?.isNew && changedFieldKeys.includes(key);
  const onSaveValue = actions.onSaveValue;
  const onCorrect = actions.onCorrect;
  const onUpdateStatusOptions = actions.onUpdateStatusOptions;
  const isAdmin = actions.isAdmin === true;
  const isStaffUser = actions.isStaff !== false;
  // Vendors mogen een custom kolom alleen bewerken als de admin dat expliciet heeft aangezet
  // (Data model > Editable by vendor). Staff kan custom kolommen altijd bewerken.
  const canEditCustomColumn = isStaffUser || column.vendorEditable === true;
  const showHistoryIndicators = actions.showHistoryIndicators !== false;
  const onCorrectAllLines = actions.onCorrectAllLines;
  const resolvedDatePeriodModes = datePeriodDisplayModes || actions.datePeriodDisplayModes || {};
  const showHistory = showHistoryIndicators !== false && Boolean(order.historyByColumnId?.[column.id]);

  const handleSave = useCallback((value) => {
    onSaveValue({
      columnId: column.id,
      columnKey: key,
      dataAreaId: order.dataAreaId,
      orderNumber: order.orderNumber,
      lineNumber: null,
      value,
    });
  }, [column.id, key, onSaveValue, order.dataAreaId, order.orderNumber]);

  const handleCorrect = useCallback(({ value, basedOnValue }) => onCorrect({
    columnId: column.id,
    columnKey: key,
    dataAreaId: order.dataAreaId,
    orderNumber: order.orderNumber,
    lineNumber: null,
    value,
    basedOnValue,
  }), [column.id, key, onCorrect, order.dataAreaId, order.orderNumber]);

  const handleUpdateStatusOptions = useCallback((options, statusReassignments) => {
    if (typeof onUpdateStatusOptions !== 'function') return Promise.resolve();
    return onUpdateStatusOptions(column.id, options, column.label, statusReassignments);
  }, [column.id, column.label, onUpdateStatusOptions]);

  const formattedTextStyle = isConditionalFormat ? { color: FORMATTED_CELL_TEXT_COLOR } : undefined;

  if (isProductImageColumn(column)) {
    if (order.removedInD365 || !productImageSummary.firstItemNumber) return null;
    return (
      <PurchaseOrderProductImageCell
        dataAreaId={order.dataAreaId}
        itemNumber={productImageSummary.firstItemNumber}
        additionalItemCount={productImageSummary.additionalItemCount}
        isConditionalFormat={isConditionalFormat}
      />
    );
  }

  if (isDatePeriodColumn(column)) {
    const displayMode = normalizeDatePeriodDisplayMode(resolvedDatePeriodModes[column.key]);
    const display = resolveDatePeriodCellValue(column, order?.values, displayMode) || '-';
    const displayNode = isChangedCell && !cellBackgroundColor
      ? <span className={styles.changedCell}>{display}</span>
      : display;
    const formattedDisplayNode = isConditionalFormat
      ? <span style={formattedTextStyle}>{displayNode}</span>
      : displayNode;
    return order.removedInD365
      ? <span className={styles.removedText}>{formattedDisplayNode}</span>
      : formattedDisplayNode;
  }

  if (linkedLineValueMeta) {
    const linkedValueNode = (
      <PurchaseOrderLinkedHeaderValue
        order={order}
        headerColumnKey={key}
        meta={linkedLineValueMeta}
        onCorrectAllLines={onCorrectAllLines}
        cellBackgroundColor={cellBackgroundColor}
        isConditionalFormat={isConditionalFormat}
        hasHistory={showHistory}
        cellKeys={{
          columnId: column.id,
          dataAreaId: order.dataAreaId,
          orderNumber: order.orderNumber,
          lineNumber: null,
        }}
      />
    );
    const wrappedLinkedValueNode = isChangedCell && !cellBackgroundColor
      ? <span className={styles.changedCell}>{linkedValueNode}</span>
      : linkedValueNode;
    return order.removedInD365
      ? <span className={styles.removedText}>{wrappedLinkedValueNode}</span>
      : wrappedLinkedValueNode;
  }

  if (column.source === 'custom' && !isFormulaColumn && !isDatePeriodColumn(column) && !linkedLineTotalColumnKey) {
    if (isStatusColumn(column)) {
      if (!canEditCustomColumn) {
        return formatCellValue(rawValue, column.dataType, column);
      }
      return (
        <StatusCell
          value={rawValue}
          options={column.options}
          onSave={handleSave}
          onUpdateOptions={handleUpdateStatusOptions}
          isAdmin={isAdmin}
          ariaLabel={`${column.label} for order ${order.orderNumber}`}
          hasHistory={showHistory}
          cellKeys={{
            columnId: column.id,
            dataAreaId: order.dataAreaId,
            orderNumber: order.orderNumber,
            lineNumber: null,
          }}
        />
      );
    }
    // Push-to-header bewaart ISO-datums in een custom text-kolom. Niet inline bewerken:
    // de koppeling overschrijft de waarde bij elke board-read. Toon dd/mm/yyyy zoals op de regels.
    // Echte custom date-kolommen blijven de kalender-editor houden.
    const columnType = String(column.dataType || '').trim().toLowerCase();
    const isPushedIsoDate = isDateLikeCellValue(rawValue)
      && columnType !== 'date'
      && columnType !== 'datetime'
      && columnType !== 'date-time';
    if (isPushedIsoDate) {
      // Meerdere gepushte regel-datums: toon de eerste datum met een "+N"-badge,
      // net als de "+N"-badge op de Image-kolom (PurchaseOrderLinkedValueCell).
      const joinedPreview = getJoinedDateValuePreview(rawValue);
      if (joinedPreview) {
        const joinedValueNode = (
          <PurchaseOrderLinkedValueCell
            firstValue={joinedPreview.firstValue}
            additionalCount={joinedPreview.additionalCount}
            allValuesLabel={joinedPreview.allValuesLabel}
            isConditionalFormat={isConditionalFormat}
          />
        );
        const wrappedJoinedValueNode = isChangedCell && !cellBackgroundColor
          ? <span className={styles.changedCell}>{joinedValueNode}</span>
          : joinedValueNode;
        return order.removedInD365
          ? <span className={styles.removedText}>{wrappedJoinedValueNode}</span>
          : wrappedJoinedValueNode;
      }
    }

    if (!isPushedIsoDate) {
      if (!canEditCustomColumn) {
        const readOnlyDisplay = formatCellValue(rawValue, column.dataType, column);
        return isChangedCell && !cellBackgroundColor
          ? <span className={styles.changedCell}>{readOnlyDisplay}</span>
          : readOnlyDisplay;
      }
      return (
        <span className={isChangedCell && !cellBackgroundColor ? styles.changedCell : undefined}>
          <EditableCell
            dataType={column.dataType}
            value={rawValue}
            options={column.options}
            cellBackgroundColor={cellBackgroundColor}
            isConditionalFormat={isConditionalFormat}
            ariaLabel={`${column.label} for order ${order.orderNumber}`}
            hasHistory={showHistory}
            cellKeys={{
              columnId: column.id,
              dataAreaId: order.dataAreaId,
              orderNumber: order.orderNumber,
              lineNumber: null,
            }}
            onSave={handleSave}
          />
        </span>
      );
    }
  }

  if (column.source === 'd365' && column.writableToD365 && onCorrect) {
    return (
      <span className={isChangedCell && !cellBackgroundColor ? styles.changedCell : undefined}>
        <PurchaseOrderWriteBackCell
          column={column}
          value={rawValue}
          cellBackgroundColor={cellBackgroundColor}
          isConditionalFormat={isConditionalFormat}
          hasHistory={showHistory}
          cellKeys={{
            columnId: column.id,
            dataAreaId: order.dataAreaId,
            orderNumber: order.orderNumber,
            lineNumber: null,
          }}
          onCorrect={handleCorrect}
        />
      </span>
    );
  }

  // Gekoppelde totaal-kolommen staan al in order.values: de waarde komt uit de board-read.
  const display = linkedLineTotalColumnKey
    ? formatCellValue(rawValue, column.dataType)
    : formatCellValue(rawValue, column.dataType, column);
  const rawDisplayNode = isFormulaColumn
    ? (
      <span className={formulaError ? styles.formulaError : undefined} title={formulaError || undefined}>
        {formulaError ? 'Formula error' : display}
      </span>
    )
    : display;
  const displayNode = isChangedCell && !cellBackgroundColor
    ? <span className={styles.changedCell}>{rawDisplayNode}</span>
    : rawDisplayNode;
  const formattedDisplayNode = isConditionalFormat
    ? <span style={formattedTextStyle}>{displayNode}</span>
    : displayNode;

  return order.removedInD365
    ? <span className={styles.removedText}>{formattedDisplayNode}</span>
    : formattedDisplayNode;
}

export default memo(PurchaseOrderHeaderCellContent);
