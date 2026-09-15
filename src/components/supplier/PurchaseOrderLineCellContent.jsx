import React from 'react';
import { Badge } from '@fluentui/react-components';
import EditableCell from './EditableCell';
import StatusCell from './StatusCell';
import PurchaseOrderWriteBackCell from './PurchaseOrderWriteBackCell';
import PurchaseOrderProductImageCell from './PurchaseOrderProductImageCell';
import PurchaseOrderLinkedValueCell from './PurchaseOrderLinkedValueCell';
import { FORMATTED_CELL_TEXT_COLOR } from './columnTextStyleUtils';
import { formatCellValue } from '../../utils/purchaseOrderFormat';
import { isStatusColumn } from '../../utils/statusColumnUtils';
import { isProductImageColumn } from '../../utils/purchaseOrderProductImageColumn';
import { isProductAttributeColumn } from '../../utils/productAttributeColumn';

export function renderLineCellContent({
  line,
  column,
  firstDataColumn,
  order,
  onSaveValue,
  onCorrect,
  onUpdateStatusOptions,
  isAdmin = false,
  isStaff = true,
  styles,
  cellBackgroundColor = '',
  isConditionalFormat = false,
  showHistoryIndicators = true,
}) {
  const rawValue = line.values?.[column.key];
  const showHistory = showHistoryIndicators !== false && Boolean(line.historyByColumnId?.[column.id]);
  const showLineBadge = column === firstDataColumn && (line?.isNew || line?.isChanged || line?.isRemoved);
  const itemNumber = line?.itemNumber ?? line?.values?.itemNumber;

  if (isProductImageColumn(column)) {
    if (line?.isRemoved) return null;
    return (
      <PurchaseOrderProductImageCell
        dataAreaId={order.dataAreaId}
        itemNumber={itemNumber}
        isConditionalFormat={isConditionalFormat}
      />
    );
  }

  const lineBadge = line?.isRemoved
    ? <Badge appearance="tint" color="danger" size="small">removed</Badge>
    : (line?.isNew
      ? <Badge appearance="tint" color="success" size="small">new</Badge>
      : (line?.isChanged ? <Badge appearance="tint" color="warning" size="small">changed</Badge> : null));

  if (line?.isRemoved) {
    return (
      <span className={showLineBadge ? styles.statusWrap : undefined}>
        <span className={styles.removedText}>
          {formatCellValue(rawValue, column.dataType, column)}
        </span>
        {showLineBadge ? lineBadge : null}
      </span>
    );
  }
  if (isProductAttributeColumn(column)) {
    const extra = line?.pavExtras?.[column.key];
    return (
      <PurchaseOrderLinkedValueCell
        firstValue={rawValue == null || rawValue === '' ? '' : String(rawValue)}
        additionalCount={extra?.additionalCount || 0}
        allValuesLabel={extra?.allValuesLabel || ''}
        hover="title"
        isConditionalFormat={isConditionalFormat}
      />
    );
  }
  if (column.source === 'custom') {
    // Vendors mogen een custom kolom alleen bewerken als de admin dat expliciet heeft aangezet
    // (Data model > Editable by vendor). Staff kan custom kolommen altijd bewerken.
    const canEditCustomColumn = isStaff || column.vendorEditable === true;
    if (!canEditCustomColumn) {
      return (
        <span className={showLineBadge ? styles.statusWrap : undefined}>
          <span style={isConditionalFormat ? { color: FORMATTED_CELL_TEXT_COLOR } : undefined}>
            {formatCellValue(rawValue, column.dataType, column)}
          </span>
          {showLineBadge ? lineBadge : null}
        </span>
      );
    }
    if (isStatusColumn(column)) {
      return (
        <span className={showLineBadge ? styles.statusWrap : undefined}>
          <StatusCell
            value={rawValue}
            options={column.options}
            isAdmin={isAdmin}
            ariaLabel={`${column.label} for line ${line.lineNumber}`}
            hasHistory={showHistory}
            cellKeys={{
              columnId: column.id,
              dataAreaId: order.dataAreaId,
              orderNumber: order.orderNumber,
              lineNumber: line.lineNumber,
            }}
            onSave={(value) =>
              onSaveValue({
                columnId: column.id,
                columnKey: column.key,
                dataAreaId: order.dataAreaId,
                orderNumber: order.orderNumber,
                lineNumber: line.lineNumber,
                value,
              })
            }
            onUpdateOptions={(options, statusReassignments) =>
              onUpdateStatusOptions?.(column.id, options, column.label, statusReassignments)
            }
          />
          {showLineBadge ? lineBadge : null}
        </span>
      );
    }
    return (
      <span className={showLineBadge ? styles.statusWrap : undefined}>
        <EditableCell
          dataType={column.dataType}
          value={rawValue}
          options={column.options}
          cellBackgroundColor={cellBackgroundColor}
          isConditionalFormat={isConditionalFormat}
          ariaLabel={`${column.label} for line ${line.lineNumber}`}
          hasHistory={showHistory}
          cellKeys={{
            columnId: column.id,
            dataAreaId: order.dataAreaId,
            orderNumber: order.orderNumber,
            lineNumber: line.lineNumber,
          }}
          onSave={(value) =>
            onSaveValue({
              columnId: column.id,
              columnKey: column.key,
              dataAreaId: order.dataAreaId,
              orderNumber: order.orderNumber,
              lineNumber: line.lineNumber,
              value,
            })
          }
        />
        {showLineBadge ? lineBadge : null}
      </span>
    );
  }
  if (column.source === 'd365' && column.writableToD365 && onCorrect) {
    return (
      <span className={showLineBadge ? styles.statusWrap : undefined}>
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
            lineNumber: line.lineNumber,
          }}
          onCorrect={({ value, basedOnValue }) =>
            onCorrect({
              columnId: column.id,
              columnKey: column.key,
              dataAreaId: order.dataAreaId,
              orderNumber: order.orderNumber,
              lineNumber: line.lineNumber,
              value,
              basedOnValue,
            })
          }
        />
        {showLineBadge ? lineBadge : null}
      </span>
    );
  }
  return (
    <span className={showLineBadge ? styles.statusWrap : undefined}>
      <span
        className={line?.isRemoved ? styles.removedText : undefined}
        style={isConditionalFormat ? { color: FORMATTED_CELL_TEXT_COLOR } : undefined}
      >
        {formatCellValue(rawValue, column.dataType, column)}
      </span>
      {showLineBadge ? lineBadge : null}
    </span>
  );
}
