import { makeStaticStyles, makeStyles, tokens } from '@fluentui/react-components';
import { motion, tourLayers } from '../../styles/motionTokens';

/** Class for the Fluent Portal mount node, so the tour stays above dialogs/menus opened during a guide. */
export const useTourPortalStyles = makeStyles({
  mountNode: { zIndex: tourLayers.portal },
});

/** Griffel keyframes shared by the onboarding components. */
export const keyframes = {
  fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
  cardIn: {
    from: { opacity: 0, transform: 'translateY(8px) scale(0.96)' },
    to: { opacity: 1, transform: 'translateY(0) scale(1)' },
  },
  riseIn: {
    from: { opacity: 0, transform: 'translateY(12px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
  },
  contentIn: {
    from: { opacity: 0, transform: 'translateX(6px)' },
    to: { opacity: 1, transform: 'translateX(0)' },
  },
  pulseRing: {
    '0%': { boxShadow: `0 0 0 0 ${tokens.colorBrandStroke2}` },
    '70%': { boxShadow: '0 0 0 12px transparent' },
    '100%': { boxShadow: '0 0 0 0 transparent' },
  },
  hintDot: {
    '0%, 100%': { transform: 'scale(1)', opacity: 1 },
    '50%': { transform: 'scale(1.6)', opacity: 0.5 },
  },
  nudge: {
    '0%, 100%': { transform: 'translateX(0)' },
    '20%': { transform: 'translateX(-6px)' },
    '40%': { transform: 'translateX(5px)' },
    '60%': { transform: 'translateX(-3px)' },
    '80%': { transform: 'translateX(2px)' },
  },
  float: {
    '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
    '50%': { transform: 'translate3d(12px, -10px, 0) scale(1.08)' },
  },
  confetti: {
    '0%': { opacity: 1, transform: 'translate(0, 0) rotate(0deg) scale(1)' },
    '100%': { opacity: 0, transform: 'translate(var(--tour-tx), var(--tour-ty)) rotate(var(--tour-r)) scale(0.6)' },
  },
};

export const reducedMotion = {
  '@media (prefers-reduced-motion: reduce)': {
    animationName: 'none',
    transitionDuration: '1ms',
  },
};

export function enterAnimation(name, duration = motion.durationNormal, delay = 0) {
  return {
    animationName: name,
    animationDuration: `${duration}ms`,
    animationDelay: `${delay}ms`,
    animationTimingFunction: motion.easeOut,
    animationFillMode: 'both',
    ...reducedMotion,
  };
}

/**
 * While a tour step spotlights a hover-only control (the column "…" button), the engine sets
 * data-tour-reveal on its header cell so the control stays visible without hovering.
 * Documented exception to "no global styles": scoped to that attribute, which only exists during a tour.
 */
export const useTourRevealStyles = makeStaticStyles({
  '[data-tour-reveal] [data-column-menu-trigger="true"]': {
    opacity: '1 !important',
    pointerEvents: 'auto !important',
  },
});
