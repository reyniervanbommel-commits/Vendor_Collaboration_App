import React from 'react';
import { Text, makeStyles, shorthands, tokens } from '@fluentui/react-components';
import { tabHoverFilterRows } from '../../../utils/viewTabs';

const useStyles = makeStyles({
  card: {
    position: 'fixed',
    zIndex: 1000,
    pointerEvents: 'none',
    minWidth: '180px',
    maxWidth: '320px',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    boxShadow: tokens.shadow16,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke1),
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
  },
  title: {
    display: 'block',
    marginBottom: tokens.spacingVerticalS,
  },
  filters: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    columnGap: tokens.spacingHorizontalS,
    rowGap: tokens.spacingVerticalXXS,
    alignItems: 'baseline',
  },
  label: {
    color: tokens.colorNeutralForeground1,
    whiteSpace: 'nowrap',
  },
  detail: {
    color: tokens.colorNeutralForeground2,
    minWidth: 0,
  },
  empty: {
    display: 'block',
    color: tokens.colorNeutralForeground2,
    gridColumnStart: 1,
    gridColumnEnd: -1,
  },
});

export default function PurchaseOrderViewTabHoverCard({ tab, columns = [], viewBaseFilters = {}, anchorRect }) {
  const styles = useStyles();
  if (!tab || !anchorRect) return null;
  const rows = tabHoverFilterRows(tab, columns, viewBaseFilters);
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 328));

  return (
    <div
      className={styles.card}
      role="tooltip"
      style={{ left: `${left}px`, top: `${anchorRect.top + 6}px` }}
    >
      <Text weight="semibold" className={styles.title}>{tab.name || 'All'}</Text>
      <div className={styles.filters}>
        {rows.map((row) => (
          row.label ? (
            <React.Fragment key={`${row.label}-${row.detail}`}>
              <Text size={200} className={styles.label}>{row.label}</Text>
              <Text size={200} className={styles.detail}>{row.detail}</Text>
            </React.Fragment>
          ) : (
            <Text key={row.detail} size={200} className={styles.empty}>
              {row.detail}
            </Text>
          )
        ))}
      </div>
    </div>
  );
}
