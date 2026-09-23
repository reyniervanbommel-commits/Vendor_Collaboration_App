import React, { memo } from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import PurchaseOrderDataCell from './PurchaseOrderDataCell';
import { getColumnCellStyle, getFormattedCellContentStyle } from './columnTextStyleUtils';
import { evalFormatRules } from './columnFormatRuleUtils';
import { resolveSubitemConnectorCellClassName } from './purchaseOrderSubitemConnectorStyles';
import { isStatusColumn, resolveStatusCellColor } from '../../utils/statusColumnUtils';
import {
  getProductImageCellStyle,
  isProductImageColumn,
  PRODUCT_IMAGE_SUB_CELL_HEIGHT,
} from '../../utils/purchaseOrderProductImageColumn';
import PurchaseOrderCollapsedColumnCell from './PurchaseOrderCollapsedColumnCell';
import { isColumnCollapsed } from '../../utils/collapsedColumnUtils';
import { renderLineCellContent } from './PurchaseOrderLineCellContent';

const useStyles = makeStyles({
  statusWrap: {
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: '6px',
    maxWidth: '100%',
    minWidth: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  removedText: {
    color: tokens.colorNeutralForeground3,
    textDecorationLine: 'line-through',
  },
});

export function resolveLineRowFormatColor(line, lineColumns, columnFormatRules) {
  if (line?.isRemoved) return '';
  for (const column of Array.isArray(lineColumns) ? lineColumns : []) {
    const ruleSet = columnFormatRules[column.key];
    if (!ruleSet || ruleSet.target !== 'row') continue;
    const statusOptions = isStatusColumn(column) ? column.options : null;
    const color = evalFormatRules(line?.values?.[column.key], ruleSet, line?.values || {}, statusOptions);
    if (color) return color;
  }
  return '';
}

function resolveLineCellBackground({ line, column, ruleSet, rowFormatColor, isChangedCell }) {
  const rawValue = line?.values?.[column.key];
  const statusOptions = isStatusColumn(column) ? column.options : null;
  const cellFormatColor = (!line?.isRemoved && ruleSet?.target === 'cell')
    ? evalFormatRules(rawValue, ruleSet, line?.values || {}, statusOptions)
    : '';
  if (cellFormatColor) {
    return { backgroundColor: cellFormatColor, isConditionalFormat: true };
  }
  if (!line?.isRemoved && rowFormatColor) {
    return { backgroundColor: rowFormatColor, isConditionalFormat: true };
  }
  if (isStatusColumn(column)) {
    return {
      backgroundColor: resolveStatusCellColor(rawValue, column.options),
      isConditionalFormat: false,
    };
  }
  if (line?.isRemoved) return { backgroundColor: '#f3f2f1', isConditionalFormat: false };
  if (isChangedCell) return { backgroundColor: '#fff4ce', isConditionalFormat: false };
  return { backgroundColor: '', isConditionalFormat: false };
}

function PurchaseOrderSubitemLineRow({
  rowId,
  order,
  line,
  index,
  rowCount,
  hasTotalsRow,
  lineColumns,
  firstDataColumn,
  columnWidths,
  columnTextStyles,
  columnFormatRules,
  collapsedLineColumnKeys,
  onSaveValue,
  onCorrect,
  onUpdateStatusOptions,
  isAdmin,
  isStaff = true,
  subCellClassName,
  subCellContentClassName,
  connectorStyles,
  showHistoryIndicators,
}) {
  const styles = useStyles();
  const rowFormatColor = resolveLineRowFormatColor(line, lineColumns, columnFormatRules);
  const connectorCellClassName = connectorStyles
    ? resolveSubitemConnectorCellClassName({ index, rowCount, hasTotalsRow, styles: connectorStyles })
    : '';
  return (
    <tr style={!line?.isRemoved && rowFormatColor ? { backgroundColor: rowFormatColor } : undefined}>
      {connectorCellClassName ? (
        <td className={connectorCellClassName} aria-hidden="true" />
      ) : null}
      {lineColumns.map((column) => {
        if (isColumnCollapsed(column.key, collapsedLineColumnKeys)) {
          return (
            <PurchaseOrderCollapsedColumnCell
              key={`${rowId}-${line.lineNumber ?? index}-${column.key}`}
              columnKey={column.key}
            />
          );
        }
        const changedFieldKeys = Array.isArray(line?.changedFieldKeys) ? line.changedFieldKeys : [];
        const isChangedCell = !line?.isRemoved && !line?.isNew && changedFieldKeys.includes(column.key);
        const ruleSet = columnFormatRules?.[column.key];
        const { backgroundColor: cellBackground, isConditionalFormat } = resolveLineCellBackground({
          line,
          column,
          ruleSet,
          rowFormatColor,
          isChangedCell,
        });
        const isImageColumn = isProductImageColumn(column);
        const isStatus = isStatusColumn(column);
        const baseCellStyle = getColumnCellStyle(
          columnWidths,
          columnTextStyles,
          column.key,
          cellBackground,
          { useFormattedTextColor: isConditionalFormat }
        );
        const cellStyle = isImageColumn
          ? getProductImageCellStyle(baseCellStyle, PRODUCT_IMAGE_SUB_CELL_HEIGHT)
          : {
            ...baseCellStyle,
            ...(isStatus ? {
              padding: 0,
              '--po-cell-padding-y': '0px',
              '--po-cell-padding-x': '0px',
            } : {}),
          };
        return (
          <PurchaseOrderDataCell
            key={`${rowId}-${line.lineNumber ?? index}-${column.key}`}
            cell={{ column, rawValue: line.values?.[column.key], order, trackMarks: line.trackMarksByColumnId }}
            layout={{
              className: subCellClassName,
              contentClassName: (isImageColumn || isStatus) ? undefined : subCellContentClassName,
              contentStyle: isStatus
                ? { height: '100%', minHeight: 0, overflow: 'visible' }
                : getFormattedCellContentStyle(isConditionalFormat),
              style: cellStyle,
            }}
          >
            {renderLineCellContent({
              line,
              column,
              firstDataColumn,
              order,
              onSaveValue,
              onCorrect,
              onUpdateStatusOptions,
              isAdmin,
              isStaff,
              styles,
              cellBackgroundColor: cellBackground,
              isConditionalFormat,
              showHistoryIndicators,
            })}
          </PurchaseOrderDataCell>
        );
      })}
    </tr>
  );
}

export default memo(PurchaseOrderSubitemLineRow);
