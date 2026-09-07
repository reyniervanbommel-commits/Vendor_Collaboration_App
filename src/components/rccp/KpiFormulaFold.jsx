import React, { useCallback, useContext, useState } from 'react';
import {
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Text,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { brandColor, interaction } from '../../styles/brandTokens';
import { KPI_STYLE_KEYS } from '../../utils/kpiCardStyles';
import KpiCardStyleFields from './KpiCardStyleFields';
import { useKpiCardStyle } from './useKpiCardStyles';
import { AuthContext } from '../../context/AuthContext';

const HIT_SIZE = '32px';
const FOLD_SIZE = '10px';

const foldHidden = {
  opacity: 0,
  transform: 'translate(4px, -4px)',
  transitionProperty: 'opacity, transform',
  transitionDuration: tokens.durationNormal,
  transitionTimingFunction: tokens.curveEasyEase,
};

const foldVisible = {
  opacity: 1,
  transform: 'translate(0, 0)',
};

const useStyles = makeStyles({
  trigger: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 5,
    width: HIT_SIZE,
    height: HIT_SIZE,
    ...shorthands.padding('0'),
    ...shorthands.border('0'),
    backgroundColor: 'transparent',
    cursor: 'pointer',
    '::before': {
      content: '""',
      position: 'absolute',
      top: 0,
      right: 0,
      zIndex: 0,
      width: FOLD_SIZE,
      height: FOLD_SIZE,
      backgroundColor: interaction.cellHistoryFoldShadow,
      clipPath: 'polygon(0 0, 0 100%, 100% 100%)',
      mixBlendMode: 'multiply',
      pointerEvents: 'none',
      ...foldHidden,
    },
    '::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      right: 0,
      zIndex: 0,
      width: FOLD_SIZE,
      height: FOLD_SIZE,
      backgroundColor: brandColor.cellHistoryFoldPaper,
      clipPath: 'polygon(0 0, 100% 0, 100% 100%)',
      pointerEvents: 'none',
      ...foldHidden,
    },
    ':hover': {
      '::before': foldVisible,
      '::after': foldVisible,
      '& [data-fold-divider]': foldVisible,
    },
    ':focus-visible': {
      outlineColor: tokens.colorBrandStroke1,
      outlineStyle: 'solid',
      outlineWidth: '2px',
      '::before': foldVisible,
      '::after': foldVisible,
      '& [data-fold-divider]': foldVisible,
    },
  },
  triggerOpen: {
    '::before': foldVisible,
    '::after': foldVisible,
    '& [data-fold-divider]': foldVisible,
  },
  foldDivider: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 1,
    width: FOLD_SIZE,
    height: FOLD_SIZE,
    pointerEvents: 'none',
    backgroundImage: `linear-gradient(45deg, transparent calc(50% - 0.5px), ${interaction.cellHistoryFoldDivider} 50%, transparent calc(50% + 0.5px))`,
    ...foldHidden,
  },
  surface: {
    maxWidth: '280px',
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalS),
  },
  title: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  formula: {
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: 'pre-line',
  },
});

/**
 * Folded-corner trigger. Opens formula; percentage cards also get color settings.
 */
function KpiFormulaFold({ formula, kpiKey }) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  // Alleen employee/admin mogen de kaart-kleur en -opacity aanpassen; suppliers zien enkel de formule.
  const auth = useContext(AuthContext);
  const userRole = auth?.user?.role;
  const canEditCardStyle = userRole === 'employee' || userRole === 'admin';
  const formulaId = `kpi-formula-${kpiKey}`;
  const showStyle = KPI_STYLE_KEYS.includes(kpiKey) && canEditCardStyle;
  const { style, updateStyle } = useKpiCardStyle(kpiKey);
  const stopCardClick = useCallback((event) => {
    event.stopPropagation();
  }, []);
  const handleOpenChange = useCallback((_, data) => {
    setOpen(Boolean(data.open));
  }, []);
  if (!formula) return null;
  const triggerLabel = showStyle ? 'Card settings' : 'View formula';
  return (
    <Popover withArrow size="small" open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger disableButtonEnhancement>
        <button
          type="button"
          className={mergeClasses(styles.trigger, open && styles.triggerOpen)}
          aria-label={triggerLabel}
          title={triggerLabel}
          data-kpi-formula-trigger="true"
          onClick={stopCardClick}
          onMouseDown={stopCardClick}
          onPointerDown={stopCardClick}
        >
          <span className={styles.foldDivider} data-fold-divider aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverSurface className={styles.surface} onClick={stopCardClick}>
        {showStyle ? <KpiCardStyleFields style={style} onChange={updateStyle} /> : null}
        <Text className={styles.title} id={formulaId}>Formula</Text>
        <Text className={styles.formula}>{formula}</Text>
      </PopoverSurface>
    </Popover>
  );
}

export default KpiFormulaFold;
