/**
 * Motion tokens — shared durations/easings for animated UI (product tour, onboarding).
 * Always pair with a prefers-reduced-motion fallback (see docs/guides/UI_DESIGN_STANDARDS.md §4).
 */

export const motion = {
  durationFast: 160,
  durationNormal: 240,
  durationSlow: 420,
  easeOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
  easeStandard: 'cubic-bezier(0.33, 0, 0.67, 1)',
  pulseLoopMs: 1800,
};

/**
 * Tour layers. Fluent mounts every portal (dialogs, menus, popovers) in a node with z-index 1000000,
 * later ones on top — so the tour's own portal node sits just above that, and overlay/card stack inside it.
 */
export const tourLayers = {
  portal: 1000100,
  overlay: 3100,
  card: 3200,
};

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
