import React, { memo } from 'react';
import { Portal, makeStyles, shorthands, tokens } from '@fluentui/react-components';

const CARD_MAX_WIDTH = 220;

const useStyles = makeStyles({
  card: {
    position: 'fixed',
    zIndex: 2000,
    width: 'max-content',
    maxWidth: `${CARD_MAX_WIDTH}px`,
    pointerEvents: 'none',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    boxShadow: tokens.shadow16,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    ...shorthands.padding(tokens.spacingVerticalXS, tokens.spacingHorizontalS),
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    overflowWrap: 'anywhere',
  },
  summary: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: tokens.spacingHorizontalXXS,
    rowGap: tokens.spacingVerticalXXS,
  },
  operator: {
    color: tokens.colorNeutralForeground3,
  },
  value: {
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightBold,
  },
});

function clampLeft(left) {
  const minLeft = 8;
  const maxLeft = typeof window === 'undefined'
    ? left
    : Math.max(minLeft, window.innerWidth - CARD_MAX_WIDTH - 8);
  return Math.min(Math.max(minLeft, left), maxLeft);
}

function PurchaseOrderColumnHeaderHoverCard({ hover, model }) {
  const styles = useStyles();
  if (!hover || !model?.text) return null;

  return (
    <Portal>
      <div
        role="tooltip"
        className={styles.card}
        style={{ top: hover.top, left: clampLeft(hover.left) }}
      >
        <span className={styles.summary}>
          {(model.parts || [{ type: 'operator', text: model.text }]).map((part, index) => (
            <span
              key={`${part.type}-${index}`}
              className={part.type === 'value' ? styles.value : styles.operator}
            >
              {index > 0 ? ' ' : ''}{part.text}
            </span>
          ))}
        </span>
      </div>
    </Portal>
  );
}

export default memo(PurchaseOrderColumnHeaderHoverCard);
