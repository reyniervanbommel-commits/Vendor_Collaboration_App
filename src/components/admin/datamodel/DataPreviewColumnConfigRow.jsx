import React, { useCallback, useState } from 'react';
import {
  Badge,
  Button,
  mergeClasses,
  Switch,
  TableCell,
  TableRow,
  Text,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { ArrowUploadRegular, LinkRegular, LockClosedRegular } from '@fluentui/react-icons';
import ConfirmDialog from '../../shared/ConfirmDialog';
import {
  customColumnDeleteMessage,
  linkedFromLineHint,
  linkedFromLineLabel,
} from './entityConfigTableUtils';

const useStyles = makeStyles({
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  valueCell: {
    whiteSpace: 'nowrap',
    fontSize: tokens.fontSizeBase200,
    maxWidth: '240px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    ...shorthands.padding('6px', '12px'),
  },
  hiddenRow: { opacity: 0.55 },
  relationRow: { backgroundColor: 'rgba(255, 179, 0, 0.09)' },
  fieldCell: { whiteSpace: 'normal' },
  cellCenter: { display: 'flex', alignItems: 'center', ...shorthands.gap('6px') },
  fieldBadges: {
    display: 'inline-flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: tokens.spacingHorizontalXS,
    rowGap: tokens.spacingVerticalXXS,
  },
  deleteButton: { minWidth: '92px' },
});

export default function DataPreviewColumnConfigRow({
  column,
  typeLabel,
  sampleValue,
  isRelationField,
  togglingKey,
  onToggleVisibility,
  onToggleVisibleAtDelete,
  onToggleWriteback,
  onToggleVendorEditable,
  onDeleteColumn,
  relationBadgeLabel = 'Header-Line link key',
}) {
  const styles = useStyles();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const handleVisibility = useCallback(() => onToggleVisibility(column), [onToggleVisibility, column]);
  const handleVisibleAtDelete = useCallback(() => onToggleVisibleAtDelete(column), [onToggleVisibleAtDelete, column]);
  const handleWriteback = useCallback(() => onToggleWriteback(column), [onToggleWriteback, column]);
  const handleVendorEditable = useCallback(() => onToggleVendorEditable(column), [onToggleVendorEditable, column]);
  const handleDelete = useCallback(() => {
    if (column.source !== 'custom') return;
    setDeleteConfirmOpen(true);
  }, [column.source]);
  const handleCancelDelete = useCallback(() => {
    setDeleteConfirmOpen(false);
  }, []);
  const handleConfirmDelete = useCallback(() => {
    setDeleteConfirmOpen(false);
    onDeleteColumn(column);
  }, [onDeleteColumn, column]);
  const visibilityBusy = togglingKey === `vis-${column.id}`;
  const visibleAtDeleteBusy = togglingKey === `vad-${column.id}`;
  const writebackBusy = togglingKey === `wb-${column.id}`;
  const vendorEditableBusy = togglingKey === `ve-${column.id}`;
  const deletingBusy = togglingKey === `del-${column.id}`;
  const bulkBusy = typeof togglingKey === 'string' && togglingKey.startsWith('bulk-');
  const rowClassName = mergeClasses(
    !column.isActive && styles.hiddenRow,
    isRelationField && styles.relationRow,
  );
  const linkedLabel = linkedFromLineLabel(column.linkedFromLine);
  const linkedHint = linkedLabel ? linkedFromLineHint(column.linkedFromLine) : '';

  return (
    <>
      <TableRow className={rowClassName}>
        <TableCell className={styles.valueCell}>
          {isRelationField ? (
            <Badge appearance="filled" color="warning" icon={<LinkRegular />}>
              {relationBadgeLabel}
            </Badge>
          ) : (
            <Text size={200} className={styles.muted}>—</Text>
          )}
        </TableCell>
        <TableCell className={styles.valueCell}>
          <Text weight="semibold">{column.label}</Text>
        </TableCell>
        <TableCell className={mergeClasses(styles.valueCell, styles.fieldCell)}>
          {column.source === 'd365' ? (
            <span className={styles.mono}>{column.d365Field || '(derived)'}</span>
          ) : (
            <span className={styles.fieldBadges} title={linkedHint || undefined}>
              <Badge appearance="tint" color="informative" size="small">Custom column</Badge>
              {linkedLabel ? (
                <Badge appearance="tint" color="warning" size="small" icon={<LinkRegular />}>
                  {linkedLabel}
                </Badge>
              ) : null}
            </span>
          )}
        </TableCell>
        <TableCell className={styles.valueCell}>{typeLabel}</TableCell>
        <TableCell className={styles.valueCell} title={sampleValue}>{sampleValue}</TableCell>
        <TableCell className={styles.valueCell}>
          {column.hideAllowed ? (
            <Switch
              checked={column.isActive}
              disabled={visibilityBusy || bulkBusy}
              onChange={handleVisibility}
              aria-label={`Show or hide column ${column.label}`}
            />
          ) : (
            <span className={styles.cellCenter} title="Key column: cannot be hidden">
              <LockClosedRegular fontSize={14} />
              <Text size={200}>Always visible</Text>
            </span>
          )}
        </TableCell>
        <TableCell className={styles.valueCell}>
          <Switch
            checked={column.visibleAtDelete}
            disabled={visibleAtDeleteBusy || bulkBusy}
            onChange={handleVisibleAtDelete}
            aria-label={`Show column ${column.label} in the delete popup`}
          />
        </TableCell>
        <TableCell className={styles.valueCell}>
          {column.writeBackAllowed ? (
            <span className={styles.cellCenter}>
              <Switch
                checked={column.writableToD365}
                disabled={writebackBusy || bulkBusy}
                onChange={handleWriteback}
                aria-label={`Write-back to D365 for ${column.label}`}
              />
              {column.writableToD365 ? (
                <Badge appearance="tint" color="success" size="small" icon={<ArrowUploadRegular />}>
                  Enabled
                </Badge>
              ) : (
                <Badge appearance="tint" color="informative" size="small">Available</Badge>
              )}
            </span>
          ) : (
            <span
              title={
                column.source === 'custom'
                  ? 'Custom columns only exist in this app and are never written to D365'
                  : 'Key or system field: write-back is not allowed'
              }
            >
              <Badge appearance="outline" color="subtle" size="small">Not available</Badge>
            </span>
          )}
        </TableCell>
        <TableCell className={styles.valueCell}>
          {column.vendorEditableAllowed ? (
            <span className={styles.cellCenter}>
              <Switch
                checked={column.vendorEditable}
                disabled={vendorEditableBusy || bulkBusy}
                onChange={handleVendorEditable}
                aria-label={`Editable by vendor for ${column.label}`}
              />
              {column.vendorEditable ? (
                <Badge appearance="tint" color="success" size="small">Enabled</Badge>
              ) : (
                <Badge appearance="tint" color="informative" size="small">Available</Badge>
              )}
            </span>
          ) : (
            <span title="Key or system field: not editable by vendors">
              <Badge appearance="outline" color="subtle" size="small">Not available</Badge>
            </span>
          )}
        </TableCell>
        <TableCell className={styles.valueCell}>
          {column.source === 'custom' ? (
            <Button
              className={styles.deleteButton}
              appearance="secondary"
              size="small"
              disabled={deletingBusy || bulkBusy}
              onClick={handleDelete}
            >
              {deletingBusy ? 'Deleting...' : 'Delete'}
            </Button>
          ) : (
            <Text size={200} className={styles.muted}>—</Text>
          )}
        </TableCell>
      </TableRow>
      {deleteConfirmOpen ? (
        <ConfirmDialog
          open={deleteConfirmOpen}
          title="Delete custom column"
          message={customColumnDeleteMessage(column)}
          confirmText="Delete"
          cancelText="Cancel"
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      ) : null}
    </>
  );
}
