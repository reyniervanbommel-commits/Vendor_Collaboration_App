import React, { useCallback } from 'react';
import { Card, Text, makeStyles, mergeClasses, tokens, shorthands } from '@fluentui/react-components';
import { KPI_STYLE_KEYS, resolveKpiPieColors } from '../../utils/kpiCardStyles';
import { buildKpiFormulaText } from './rccpKpiFormulas';
import KpiFormulaFold from './KpiFormulaFold';
import KpiPctPie from './KpiPctPie';
import { kpiPiePercent } from './kpiPctPieUtils';
import { useKpiCardStyle } from './useKpiCardStyles';

const useStyles = makeStyles({
  wrap: {
    position: 'relative',
    minWidth: 0,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  card: {
    position: 'relative',
    boxSizing: 'border-box',
    flexGrow: 1,
    width: '100%',
    height: '100%',
    overflowX: 'hidden',
    overflowY: 'hidden',
    ...shorthands.padding(tokens.spacingVerticalL),
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalXS),
  },
  front: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalXS),
    minWidth: 0,
  },
  clickable: { cursor: 'pointer' },
  selected: {
    ...shorthands.border('2px', 'solid', tokens.colorBrandStroke1),
  },
  label: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  valueRow: {
    display: 'flex',
    alignItems: 'baseline',
    flexWrap: 'nowrap',
    whiteSpace: 'nowrap',
    ...shorthands.gap(tokens.spacingHorizontalXS),
  },
  value: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    width: 'auto',
  },
  hash: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground2,
    width: 'auto',
  },
  aside: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    width: 'auto',
  },
  pct: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground2,
  },
  detail: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

function hasQty(value) {
  return value !== null && value !== undefined;
}

export function formatQty(value) {
  if (!hasQty(value)) return '—';
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export function formatPct(value) {
  if (!hasQty(value)) return '';
  return `${(Number(value) || 0).toFixed(1)}%`;
}

export function formatDays(value) {
  if (!hasQty(value)) return '—';
  const rounded = Math.round(Number(value) * 10) / 10;
  return `Ø ${rounded} days late`;
}

export function formatItems(value) {
  if (!hasQty(value)) return '';
  return `${formatQty(value)} items`;
}

function KpiCard({ kpiKey, label, qty, hash, aside, pct, detail, selected, clickable, onActivate, config }) {
  const styles = useStyles();
  const formula = buildKpiFormulaText(kpiKey, config);
  const handleClick = useCallback(() => {
    if (clickable) onActivate(kpiKey);
  }, [clickable, kpiKey, onActivate]);
  const handleKeyDown = useCallback((event) => {
    if (!clickable) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate(kpiKey);
    }
  }, [clickable, kpiKey, onActivate]);
  const mark = hash === true ? '#' : (typeof hash === 'string' ? hash : '');
  const showMark = Boolean(mark && hasQty(qty));
  const markBefore = mark === 'Ø';
  const piePercent = pct ? kpiPiePercent(Number.parseFloat(pct)) : null;
  const { style } = useKpiCardStyle(kpiKey);
  const showStyle = piePercent != null && KPI_STYLE_KEYS.includes(kpiKey);
  // Only the pie gets the accent color; the percentage text always stays neutral.
  const pieColors = showStyle ? resolveKpiPieColors(style) : null;
  return (
    <div className={styles.wrap}>
      <Card
        className={mergeClasses(styles.card, clickable && styles.clickable, selected && styles.selected)}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-pressed={clickable ? selected : undefined}
        onClick={clickable ? handleClick : undefined}
        onKeyDown={clickable ? handleKeyDown : undefined}
      >
        <KpiPctPie
          percent={piePercent}
          fillColor={pieColors?.fill}
          restColor={pieColors?.rest}
          elevated={pieColors?.elevated}
        />
        <div className={styles.front}>
          <Text className={styles.label}>{label}</Text>
          <div className={styles.valueRow}>
            {showMark && markBefore ? <Text className={styles.hash}>{mark}</Text> : null}
            <Text className={styles.value}>{formatQty(qty)}</Text>
            {showMark && !markBefore ? <Text className={styles.hash}>{mark}</Text> : null}
            {aside ? <Text className={styles.aside}>{aside}</Text> : null}
          </div>
          {pct ? <Text className={styles.pct}>{pct}</Text> : null}
          {detail ? <Text className={styles.detail}>{detail}</Text> : null}
        </div>
      </Card>
      <KpiFormulaFold formula={formula} kpiKey={kpiKey} />
    </div>
  );
}

export default KpiCard;
