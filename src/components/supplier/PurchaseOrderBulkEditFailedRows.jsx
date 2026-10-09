import React, { memo } from 'react';
import {
  Badge,
  Button,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  root: {
    marginTop: tokens.spacingVerticalM,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shorthands.gap('12px'),
    marginBottom: tokens.spacingVerticalS,
  },
  headerText: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  tableWrap: {
    maxHeight: '280px',
    overflowY: 'auto',
    overflowX: 'auto',
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
  },
  headerCell: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    backgroundColor: tokens.colorNeutralBackground2,
    whiteSpace: 'nowrap',
    fontWeight: tokens.fontWeightSemibold,
  },
  orderCell: {
    whiteSpace: 'nowrap',
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
  },
  errorCell: {
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    fontSize: tokens.fontSizeBase200,
    minWidth: '220px',
    maxWidth: '360px',
    color: tokens.colorNeutralForeground2,
  },
  orderLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    ...shorthands.gap(tokens.spacingHorizontalXS),
  },
  actionCell: {
    whiteSpace: 'nowrap',
    textAlign: 'right',
  },
});

function orderLabel(row) {
  return `${row.dataAreaId}|${row.orderNumber}`;
}

/**
 * Mislukte D365 bulk-write-back rijen met per-rij en gezamenlijke retry.
 * Input: rows + retrying + handlers. Output: tabel-UI.
 */
function PurchaseOrderBulkEditFailedRows({ rows, retrying, onRetryRow, onRetryAllFailed }) {
  const styles = useStyles();
  const count = Array.isArray(rows) ? rows.length : 0;
  if (!count) return null;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.headerText}>
          {count} {count === 1 ? 'row needs attention' : 'rows need attention'}
        </span>
        <Button
          appearance="primary"
          size="small"
          icon={retrying ? <Spinner size="tiny" /> : <ArrowClockwiseRegular />}
          onClick={onRetryAllFailed}
          disabled={retrying}
        >
          Retry all failed
        </Button>
      </div>
      <div className={styles.tableWrap}>
        <Table size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell className={styles.headerCell}>Order</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell}>Error</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const errorMessage = String(row.errorMessage || '');
              return (
                <TableRow key={row.key}>
                  <TableCell className={styles.orderCell}>
                    <span className={styles.orderLabel}>
                      {orderLabel(row)}
                      {row.partial ? (
                        <Badge appearance="tint" color="warning" size="small">Partial</Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className={styles.errorCell} title={errorMessage}>
                    {errorMessage}
                  </TableCell>
                  <TableCell className={styles.actionCell}>
                    <Button
                      appearance="secondary"
                      size="small"
                      icon={<ArrowClockwiseRegular />}
                      onClick={() => onRetryRow(row.key)}
                      disabled={retrying}
                    >
                      Retry
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default memo(PurchaseOrderBulkEditFailedRows);
