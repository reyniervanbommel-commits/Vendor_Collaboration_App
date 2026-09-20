import React, { useCallback } from 'react';
import { Card, Text, makeStyles, mergeClasses, tokens, shorthands } from '@fluentui/react-components';
import { KPI_PIE_GRAY, KPI_PIE_GRAY_LIGHT, KPI_STYLE_KEYS } from '../../utils/kpiCardStyles';
import { buildKpiFormulaText } from './rccpKpiFormulas';
import KpiFormulaFold from './KpiFormulaFold';
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
    ...shorthands.padding(tokens.spacingVerticalXL, tokens.spacingHorizontalXL),
    ...shorthands.borderRadius(tokens.borderRadiusXLarge),
    display: 'flex',
    flexDirection: 'column',
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
    minWidth: 0,
  },
  // Titel + teller + aside/detail blijven als groep verticaal gecentreerd in de ruimte boven
  // de balk — dankzij `margin: auto` op déze groep (niet op de balk) staat de balk altijd
  // onderaan de kaart, terwijl de teller/badge in het midden komt te staan, ook als de
  // kaart hoger wordt.
  middleGroup: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalXS),
    minWidth: 0,
    marginTop: 'auto',
    marginBottom: 'auto',
  },
  clickable: { cursor: 'pointer' },
  selected: {
    ...shorthands.border('2px', 'solid', tokens.colorBrandStroke1),
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap(tokens.spacingHorizontalS),
  },
  labelGroup: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
    ...shorthands.gap(tokens.spacingHorizontalXXS),
  },
  label: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightRegular },
  labelCompact: { fontSize: tokens.fontSizeBase300 },
  // Pil rechts, op dezelfde hoogte als de teller (zie valueRow: justifyContent space-between).
  // Alleen op tegels met een %.
  badge: {
    flexShrink: 0,
    // Bewust een vaste witte kleur (niet colorNeutralBackground1, die in dark mode donker
    // wordt) — de badge-achtergrond is altijd een verzadigde accentkleur, dus de tekst moet
    // hier altijd wit blijven, ongeacht het thema.
    color: '#ffffff',
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: 'nowrap',
    ...shorthands.padding(tokens.spacingVerticalXS, tokens.spacingHorizontalL),
    ...shorthands.borderRadius(tokens.borderRadiusCircular),
  },
  badgeCompact: {
    fontSize: tokens.fontSizeBase200,
    ...shorthands.padding(tokens.spacingVerticalXXS, tokens.spacingHorizontalM),
  },
  valueRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    fontSize: tokens.fontSizeBase600,
    fontWeight: tokens.fontWeightBold,
    width: 'auto',
  },
  valueCompact: { fontSize: tokens.fontSizeBase400 },
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
  detail: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  // Compacte variant: aside + detail samen op een eigen regel, links uitgelijnd onder de
  // waarde — zo blijven de cijfers in het smalle split-paneel netjes onder elkaar staan.
  metaRowCompact: {
    display: 'flex',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    ...shorthands.gap(tokens.spacingHorizontalXS),
  },
  // Balk onderaan de kaart (referentie-ontwerp) — alleen op tegels met een %. `middleGroup`
  // hierboven centreert zichzelf via `margin: auto` in de ruimte vóór deze balk, die daardoor
  // altijd tegen de onderkant van de kaart blijft staan.
  barTrack: {
    marginTop: tokens.spacingVerticalM,
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
                <Text className={mergeClasses(styles.label, compact && styles.labelCompact)}>{label}</Text>
              </div>
            </div>
            <div className={styles.valueRow}>
              <div className={styles.valueGroup}>
                {showMark && markBefore ? (
                  <Text className={mergeClasses(styles.hash, compact && styles.hashCompact)}>{mark}</Text>
                ) : null}
                <Text className={mergeClasses(styles.value, compact && styles.valueCompact)}>{formatQty(active.qty)}</Text>
                {showMark && !markBefore ? (
                  <Text className={mergeClasses(styles.hash, compact && styles.hashCompact)}>{mark}</Text>
                ) : null}
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
            {compact ? (
              (active.aside || active.detail) && (
                <div className={styles.metaRowCompact}>
                  {active.aside ? <Text className={styles.aside}>{active.aside}</Text> : null}
                  {active.detail ? <Text className={styles.detail}>{active.detail}</Text> : null}
                </div>
              )
            ) : (
              <>
                {active.aside ? <Text className={styles.aside}>{active.aside}</Text> : null}
                {active.detail ? <Text className={styles.detail}>{active.detail}</Text> : null}
              </>
            )}
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
