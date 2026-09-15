import React from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import { arcSlicePath, kpiPiePercent, pieBisectorAngle, pieSliceOffset } from './kpiPctPieUtils';
import { KPI_PIE_GRAY, KPI_PIE_GRAY_LIGHT } from '../../utils/kpiCardStyles';
import { useAnimatedPercent } from './useAnimatedPercent';

/** Gray tones used for the uncolored slice — these must always render at the bottom. */
const GRAY_TONES = [KPI_PIE_GRAY, KPI_PIE_GRAY_LIGHT];

/** How far the colored slice pops out from the pie's center, in viewBox units. */
const POP_DISTANCE = 2;
const POP_SHADOW = 'drop-shadow(0 2px 2px rgba(0, 0, 0, 0.3))';
/** Gray slice gets a smaller radius so it visually sits behind the colored slice. */
const GRAY_RADIUS = 46;
const FULL_RADIUS = 50;
/** White divider stroke drawn between the 2 slices. */
const DIVIDER_COLOR = tokens.colorNeutralBackground1;
const DIVIDER_WIDTH = 2.5;

const useStyles = makeStyles({
  root: {
    position: 'absolute',
    right: `calc(-1 * ${tokens.spacingVerticalL})`,
    top: '50%',
    transform: 'translateY(-50%)',
    height: `calc((100% + (2 * ${tokens.spacingVerticalL})) * 0.6)`,
    aspectRatio: '1 / 1',
    width: 'auto',
    pointerEvents: 'none',
    zIndex: 0,
    overflow: 'visible',
  },
  svg: {
    display: 'block',
    width: '100%',
    height: '100%',
    overflow: 'visible',
  },
});

/**
 * 2-slice KPI pie. When one slice carries the picked accent color (`elevated`),
 * it's nudged outward from the center and gets its own small shadow, so it
 * visually pops out above the flat, uncolored slice.
 */
function KpiPctPie({ percent, fillColor, restColor, elevated }) {
  const styles = useStyles();
  const rawShare = kpiPiePercent(percent);
  const share = useAnimatedPercent(rawShare);
  if (share === null || share === undefined) return null;

  const valueAngle = pieBisectorAngle(0, share);
  const otherAngle = pieBisectorAngle(share, 100);
  const fillIsGray = GRAY_TONES.includes(fillColor);
  const restIsGray = GRAY_TONES.includes(restColor);
  const valuePath = arcSlicePath(0, share, { r: fillIsGray ? GRAY_RADIUS : FULL_RADIUS });
  const otherPath = arcSlicePath(share, 100, { r: restIsGray ? GRAY_RADIUS : FULL_RADIUS });

  const slices = [
    { key: 'fill', path: valuePath, color: fillColor, angle: valueAngle },
    { key: 'rest', path: otherPath, color: restColor, angle: otherAngle },
  ].sort((a, b) => {
    // Gray slice always renders first (bottom); the colored slice always last (top),
    // regardless of which one is "elevated".
    const aGray = GRAY_TONES.includes(a.color);
    const bGray = GRAY_TONES.includes(b.color);
    if (aGray === bGray) return 0;
    return aGray ? -1 : 1;
  });

  return (
    <div className={styles.root} data-kpi-pct-pie="" aria-hidden="true">
      <svg viewBox="-10 -10 120 120" className={styles.svg} focusable="false">
        {slices.map(({ key, path, color, angle }) => {
          if (!path) return null;
          const isElevated = key === elevated;
          const offset = isElevated ? pieSliceOffset(angle, POP_DISTANCE) : null;
          return (
            <path
              key={key}
              d={path}
              fill={color}
              stroke={DIVIDER_COLOR}
              strokeWidth={DIVIDER_WIDTH}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{
                transition: 'transform 200ms ease, d 200ms ease',
                ...(offset ? {
                  transform: `translate(${offset.x}px, ${offset.y}px)`,
                  filter: POP_SHADOW,
                } : {}),
              }}
            />
          );
        })}
      </svg>
    </div>
  );
}

export default KpiPctPie;
