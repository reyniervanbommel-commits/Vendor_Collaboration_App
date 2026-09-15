import React, { Fragment, useCallback, useState } from 'react';
import {
  Button,
  ProgressBar,
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
import { ChevronDownRegular, ChevronRightRegular } from '@fluentui/react-icons';
import { ProgressStatusBadge, StepProgress, formatProgressDate } from './OnboardingProgressStatus';

const useStyles = makeStyles({
  tableWrap: { overflowX: 'auto' },
  user: { display: 'flex', flexDirection: 'column' },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  summary: { display: 'flex', flexDirection: 'column', ...shorthands.gap('4px'), minWidth: '140px', maxWidth: '220px' },
  detailCell: { backgroundColor: tokens.colorNeutralBackground1 },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 1.2fr) auto minmax(200px, 2fr) auto',
    alignItems: 'center',
    columnGap: '16px',
    rowGap: '10px',
    ...shorthands.padding('8px', '4px', '8px', '36px'),
  },
});

const ROLE_LABELS = { admin: 'Admin', employee: 'Employee', supplier: 'Supplier' };

function UserCell({ user, styles }) {
  return (
    <span className={styles.user}>
      <Text weight="semibold">{user.displayName || user.email}</Text>
      <span className={styles.muted}>
        {user.displayName ? user.email : ''}{user.vendorAccount ? ` · ${user.vendorAccount}` : ''}
      </span>
    </span>
  );
}

function UserDetail({ row, styles }) {
  return (
    <div className={styles.detailGrid}>
      {row.progress.map((entry) => (
        <Fragment key={entry.tour.id}>
          <Text>{entry.tour.title}</Text>
          <ProgressStatusBadge status={entry.status} outdated={entry.outdated} />
          <StepProgress progress={entry} />
          <span className={styles.muted}>{formatProgressDate(entry.at)}</span>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Per-user guide progress. Without a tour filter: completion summary per user with an expandable
 * list of every tour. With a tour filter: status and furthest step for that tour.
 */
export default function OnboardingUserProgressTable({ rows, selectedTourId }) {
  const styles = useStyles();
  const [expanded, setExpanded] = useState(() => new Set());

  const toggle = useCallback((userId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  if (!rows.length) return <Text className={styles.muted}>No users match these filters.</Text>;

  if (selectedTourId) {
    return (
      <div className={styles.tableWrap}>
        <Table size="small" aria-label="Progress per user for the selected guide">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>User</TableHeaderCell>
              <TableHeaderCell>Role</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Furthest step</TableHeaderCell>
              <TableHeaderCell>Last activity</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ row, entry }) => (
              <TableRow key={row.user.id}>
                <TableCell><UserCell user={row.user} styles={styles} /></TableCell>
                <TableCell>{ROLE_LABELS[row.user.role] || row.user.role}</TableCell>
                <TableCell><ProgressStatusBadge status={entry.status} outdated={entry.outdated} /></TableCell>
                <TableCell><StepProgress progress={entry} /></TableCell>
                <TableCell>{formatProgressDate(entry.at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <Table size="small" aria-label="Guide progress per user">
        <TableHeader>
          <TableRow>
            <TableHeaderCell aria-label="Expand" style={{ width: '40px' }} />
            <TableHeaderCell>User</TableHeaderCell>
            <TableHeaderCell>Role</TableHeaderCell>
            <TableHeaderCell>Welcome seen</TableHeaderCell>
            <TableHeaderCell>Completed</TableHeaderCell>
            <TableHeaderCell>In progress / stopped</TableHeaderCell>
            <TableHeaderCell>Last activity</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ row }) => {
            const isOpen = expanded.has(row.user.id);
            const label = row.user.displayName || row.user.email;
            return (
              <Fragment key={row.user.id}>
                <TableRow>
                  <TableCell>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={isOpen ? <ChevronDownRegular /> : <ChevronRightRegular />}
                      aria-expanded={isOpen}
                      aria-label={isOpen ? `Hide guide details for ${label}` : `Show guide details for ${label}`}
                      onClick={() => toggle(row.user.id)}
                    />
                  </TableCell>
                  <TableCell><UserCell user={row.user} styles={styles} /></TableCell>
                  <TableCell>{ROLE_LABELS[row.user.role] || row.user.role}</TableCell>
                  <TableCell>{formatProgressDate(row.user.welcomeSeenAt)}</TableCell>
                  <TableCell>
                    <span className={styles.summary}>
                      <ProgressBar
                        value={row.total ? row.counts.completed / row.total : 0}
                        color="success"
                        aria-label={`${row.counts.completed} of ${row.total} completed`}
                      />
                      <span className={styles.muted}>{row.counts.completed} of {row.total}</span>
                    </span>
                  </TableCell>
                  <TableCell>{row.counts.in_progress} / {row.counts.skipped}</TableCell>
                  <TableCell>{formatProgressDate(row.lastActivity)}</TableCell>
                </TableRow>
                {isOpen ? (
                  <TableRow>
                    <TableCell colSpan={7} className={styles.detailCell}>
                      <UserDetail row={row} styles={styles} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
