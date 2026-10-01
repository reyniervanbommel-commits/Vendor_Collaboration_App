import { memo, useCallback, useMemo } from 'react';
import { Button, Checkbox } from '@fluentui/react-components';
import PurchaseOrderRowStatusBadge from './PurchaseOrderRowStatusBadge';
import { RowRemarksBadge } from './remarks';
import { useCommentPermissions } from '../../hooks/useCommentPermissions';
import { getRowFormatControlCellStyle } from './columnTextStyleUtils';
import { resolveOrderSelectionKey } from '../../hooks/usePurchaseOrderRowSelection';
import { ROW_LOCATE_HIGHLIGHT_COLOR } from '../../utils/purchaseOrderRowLocate';

export const PurchaseOrderRowControls = memo(function PurchaseOrderRowControls({
  order,
  rowId,
  hasLines,
  isExpanded,
  styles,
  selection,
  onToggleOrder,
  remarks,
  rowFormatColor = '',
  isLocated = false,
}) {
  const { canView } = useCommentPermissions();
  const selectionKey = resolveOrderSelectionKey(order, rowId);
  const controlCellStyle = useMemo(
    () => (isLocated
      ? { backgroundColor: ROW_LOCATE_HIGHLIGHT_COLOR, zIndex: 5 }
      : getRowFormatControlCellStyle(rowFormatColor)),
    [isLocated, rowFormatColor]
  );
  const hasRowFormatColor = Boolean(controlCellStyle);
  const handleSelectionChange = useCallback(() => {
    selection?.toggle?.(selectionKey);
  }, [selection, selectionKey]);
  const handleOpenRemarks = useCallback(
    (target) => remarks?.open?.(order, null, target),
    [order, remarks]
  );

  const controlCellClassName = isLocated
    ? `${styles.controlCell} ${styles.locateHighlightControlCell}`
    : styles.controlCell;

  return (
    <td className={controlCellClassName} style={controlCellStyle}>
      <div className={styles.controlCellInner}>
        <div className={styles.rowControlsCluster}>
          {selection?.enabled ? (
            <Checkbox
              className={styles.rowCheckbox}
              checked={selection.isSelected(selectionKey)}
              onChange={handleSelectionChange}
              aria-label={`Select order ${order.orderNumber}`}
            />
          ) : null}
          {hasLines ? (
            <Button
              size="small"
              appearance="subtle"
              className={styles.compactToggleButton}
              data-rowid={rowId}
              onClick={onToggleOrder}
            >
              {isExpanded ? '-' : '+'}
            </Button>
          ) : null}
          {canView ? (
            <RowRemarksBadge
              count={remarks?.summary?.count}
              orderNumber={order.orderNumber}
              onOpen={handleOpenRemarks}
              onFormattedBackground={hasRowFormatColor}
            />
          ) : null}
        </div>
        <PurchaseOrderRowStatusBadge order={order} className={styles.rowStatusBadge} />
      </div>
    </td>
  );
});
