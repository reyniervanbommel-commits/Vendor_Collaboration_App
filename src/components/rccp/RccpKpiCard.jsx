import React, { useCallback } from 'react';
import { Card, Text, makeStyles, mergeClasses, tokens, shorthands } from '@fluentui/react-components';
import { KPI_PIE_GRAY, KPI_PIE_GRAY_LIGHT, KPI_STYLE_KEYS } from '../../utils/kpiCardStyles';
import { buildKpiFormulaText } from './rccpKpiFormulas';
import KpiFormulaFold from './KpiFormulaFold';
import { kpiPiePercent } from './kpiPctPieUtils';
import { formatQty, hasQty } from './kpiQtyFormat';
import { useKpiCardStyle } from './useKpiCardStyles';

export { formatDays, formatItems, formatPct, formatQty } from './kpiQtyFormat';

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
    ...shorthands.padding(tokens.spacingVerticalXL, tokens.spacingHorizontalXL),
    ...shorthands.borderRadius(tokens.borderRadiusXLarge),
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    ...shorthands.gap(tokens.spacingVerticalS),
  },
  // Kleinere, dichter uitgelijnde variant voor het split-panel (max 8 tegels naast de grafiek).
  cardCompact: {
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
    ...shorthands.borderRadius(tokens.borderRadiusLarge),
    ...shorthands.gap(tokens.spacingVerticalXXS),
  },
  front: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    minWidth: 0,
  },
  // Titel blijft bovenaan; geen vertical centering (anders zakken tegels zonder balk).
  middleGroup: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalXS),
    minWidth: 0,
    flexShrink: 0,
  },
  clickable: { cursor: 'pointer' },
  selected: {
    ...shorthands.border('2px', 'solid', tokens.colorBrandStroke1),
  },
  headerRow: {
    display: 'flex',
    alignItems: 'flex-start',
    ...shorthands.gap(tokens.spacingHorizontalS),
    flexShrink: 0,
  },
  labelGroup: {
    display: 'flex',
    alignItems: 'flex-start',
    minWidth: 0,
    width: '100%',
    ...shorthands.gap(tokens.spacingHorizontalXXS),
  },
  label: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightRegular,
    lineHeight: tokens.lineHeightBase400,
    minHeight: `calc(${tokens.lineHeightBase400} * 2)`,
    height: `calc(${tokens.lineHeightBase400} * 2)`,
    overflowX: 'hidden',
    overflowY: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    flexShrink: 0,
  },
  labelCompact: {
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    minHeight: tokens.lineHeightBase200,
    height: tokens.lineHeightBase200,
    display: 'block',
    WebkitLineClamp: 1,
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  // Pil rechts op de items-regel. Padding bewust krap zodat 96.6% niet de teller wegdrukt.
  badge: {
    flexShrink: 0,
    color: '#ffffff',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: 'nowrap',
    ...shorthands.padding(tokens.spacingVerticalXXS, tokens.spacingHorizontalS),
    ...shorthands.borderRadius(tokens.borderRadiusCircular),
  },
  badgeCompact: {
    fontSize: tokens.fontSizeBase100,
    ...shorthands.padding('1px', tokens.spacingHorizontalXS),
  },
  valueRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'nowrap',
    ...shorthands.gap(tokens.spacingHorizontalS),
  },
  valueGroup: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
    whiteSpace: 'nowrap',
    ...shorthands.gap(tokens.spacingHorizontalXS),
  },
  value: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    width: 'auto',
    minWidth: 0,
  },
  valueCompact: {
    fontSize: tokens.fontSizeBase400,
  },
  hash: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground3,
    width: 'auto',
  },
  hashCompact: { fontSize: tokens.fontSizeBase300 },
  aside: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    width: 'auto',
  },
  asideCompact: {
    whiteSpace: 'nowrap',
    overflowX: 'hidden',
    textOverflow: 'ellipsis',
  },
  detail: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'nowrap',
    minWidth: 0,
    minHeight: tokens.lineHeightBase200,
    ...shorthands.gap(tokens.spacingHorizontalXS),
  },
  metaText: {
    display: 'flex',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    minWidth: 0,
    ...shorthands.gap(tokens.spacingHorizontalXS),
  },
  metaTextCompact: {
    flexWrap: 'nowrap',
    overflowX: 'hidden',
  },
  // Balk onderaan zodat titels op alle tegels bovenaan blijven, ook zonder %.
  barTrack: {
    marginTop: 'auto',
    width: '100%',
    height: '14px',
    backgroundColor: KPI_PIE_GRAY_LIGHT,
    overflow: 'hidden',
    flexShrink: 0,
    ...shorthands.borderRadius(tokens.borderRadiusCircular),
  },
  barTrackCompact: { height: '7px' },
  barFill: {
    height: '100%',
    ...shorthands.borderRadius(tokens.borderRadiusCircular),
    transitionProperty: 'width',
    transitionDuration: tokens.durationSlow,
    transitionTimingFunction: tokens.curveEasyEase,
  },
});

function KpiCard({
  kpiKey, label, qty, hash, aside, pct, detail, confirmed, selected, clickable, onActivate, config,
  compact = false, dateMode = 'requested',
}) {
  const styles = useStyles();
  // C/R-basis komt van buiten (centrale requested/confirmed-toggle op de pagina) — alleen
  // toepassen wanneer de server een confirmed-datum-basis heeft geleverd voor deze tegel
  // (niet voor capaciteits-KPI's, die geen datum-basis hebben).
  const showConfirmed = Boolean(confirmed) && dateMode === 'confirmed';
  const active = showConfirmed ? confirmed : { qty, hash, aside, pct, detail };
  const formula = buildKpiFormulaText(kpiKey, config, showConfirmed ? 'confirmed' : 'requested');
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
  const mark = active.hash === true ? '#' : (typeof active.hash === 'string' ? active.hash : '');
  const showMark = Boolean(mark && hasQty(active.qty));
  const markBefore = mark === 'Ø';
  const barPercent = active.pct ? kpiPiePercent(Number.parseFloat(active.pct)) : null;
  const { style } = useKpiCardStyle(kpiKey);
  // Alleen tegels met een % krijgen de badge/balk uit het referentie-ontwerp; de
  // admin-instelbare accentkleur (vouw > kaartinstellingen) kleurt beide, grijs bij geen keuze.
  const showBadge = barPercent != null && KPI_STYLE_KEYS.includes(kpiKey);
  const accentColor = (showBadge && style?.color) || KPI_PIE_GRAY;
  return (
    <div className={styles.wrap}>
      <Card
        className={mergeClasses(
          styles.card,
          compact && styles.cardCompact,
          clickable && styles.clickable,
          selected && styles.selected,
        )}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-pressed={clickable ? selected : undefined}
        onClick={clickable ? handleClick : undefined}
        onKeyDown={clickable ? handleKeyDown : undefined}
      >
        <div className={styles.front}>
          <div className={styles.middleGroup}>
            <div className={styles.headerRow}>
              <div className={styles.labelGroup}>
                <Text
                  className={mergeClasses(styles.label, compact && styles.labelCompact)}
                  data-kpi-label=""
                  title={compact ? [label, active.detail].filter(Boolean).join(' · ') : undefined}
                >
                  {label}
                </Text>
              </div>
            </div>
            <div className={styles.valueRow}>
              <div className={styles.valueGroup}>
                {showMark && markBefore ? (
                  <Text className={mergeClasses(styles.hash, compact && styles.hashCompact)}>{mark}</Text>
                ) : null}
                <Text className={mergeClasses(styles.value, compact && styles.valueCompact)}>
                  {formatQty(active.qty)}
                </Text>
                {showMark && !markBefore ? (
                  <Text className={mergeClasses(styles.hash, compact && styles.hashCompact)}>{mark}</Text>
                ) : null}
              </div>
            </div>
            {(active.aside || active.detail || showBadge) ? (
              <div className={styles.metaRow}>
                <div className={mergeClasses(styles.metaText, compact && styles.metaTextCompact)}>
                  {active.aside ? (
                    <Text className={mergeClasses(styles.aside, compact && styles.asideCompact)}>{active.aside}</Text>
                  ) : null}
                  {!compact && active.detail ? <Text className={styles.detail}>{active.detail}</Text> : null}
                </div>
                {showBadge ? (
                  <Text
                    as="span"
                    className={mergeClasses(styles.badge, compact && styles.badgeCompact)}
                    style={{ backgroundColor: accentColor }}
                    data-kpi-pct-badge=""
                  >
                    {active.pct}
                  </Text>
                ) : null}
              </div>
            ) : null}
          </div>
          {showBadge ? (
            <div
              className={mergeClasses(styles.barTrack, compact && styles.barTrackCompact)}
              data-kpi-pct-bar=""
            >
              <div className={styles.barFill} style={{ width: `${barPercent}%`, backgroundColor: accentColor }} />
            </div>
          ) : null}
        </div>
      </Card>
      <KpiFormulaFold formula={formula} kpiKey={kpiKey} />
    </div>
  );
}

export default KpiCard;
