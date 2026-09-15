/**
 * Pure helpers for the product tour / guides engine (no DOM or React).
 * State shape (mirrors server/utils/onboardingSettings.js):
 *   { welcomeSeenAt: ISO|null, tours: { [tourId]: { version, status: 'completed'|'skipped', at } } }
 */

export const EMPTY_ONBOARDING_STATE = Object.freeze({ welcomeSeenAt: null, tours: Object.freeze({}) });

const PLACEMENTS = ['bottom', 'top', 'right', 'left'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeOnboardingState(raw) {
  if (!isPlainObject(raw)) return EMPTY_ONBOARDING_STATE;
  const tours = {};
  if (isPlainObject(raw.tours)) {
    Object.entries(raw.tours).forEach(([id, entry]) => {
      if (isPlainObject(entry) && Number.isInteger(entry.version) && entry.status) tours[id] = entry;
    });
  }
  return { welcomeSeenAt: typeof raw.welcomeSeenAt === 'string' ? raw.welcomeSeenAt : null, tours };
}

/** Applies the same delta the server merges, for optimistic UI. */
export function applyOnboardingPatch(state, patch) {
  const base = normalizeOnboardingState(state);
  if (!isPlainObject(patch)) return base;
  return {
    welcomeSeenAt: patch.welcomeSeenAt !== undefined ? patch.welcomeSeenAt : base.welcomeSeenAt,
    tours: { ...base.tours, ...(isPlainObject(patch.tours) ? patch.tours : {}) },
  };
}

/**
 * A tour counts as done when it was completed or skipped at (at least) its current version.
 * An 'in_progress' entry only counts when the tour was completed before (a replay).
 */
export function isTourDone(state, tour) {
  const entry = state?.tours?.[tour?.id];
  if (!entry || Number(entry.version) < Number(tour?.version || 1)) return false;
  return entry.status !== 'in_progress' || Boolean(entry.completedAt);
}

/**
 * Summarises a stored entry for display (Guides drawer, analytics).
 * status: 'completed' (ever finished) | 'in_progress' | 'skipped' | 'not_started'
 * outdated: progress belongs to an older version of the tour
 */
export function describeTourProgress(entry, tour) {
  if (!entry) return { status: 'not_started', step: null, steps: null, at: null, outdated: false };
  const finished = entry.status === 'completed' || Boolean(entry.completedAt);
  return {
    status: finished ? 'completed' : entry.status,
    step: entry.step ?? null,
    steps: entry.steps ?? null,
    at: entry.at || entry.completedAt || null,
    outdated: Number(entry.version) < Number(tour?.version || 1),
  };
}

/**
 * Builds the stored progress entry for a tour. Keeps the highest step reached during this run
 * and never forgets an earlier completion.
 * @param {object|undefined} previous  current stored entry
 * @param {{ id: string, version?: number }} tour
 * @param {{ status: 'in_progress'|'completed'|'skipped', step: number, steps: number, now?: string, restart?: boolean }} progress
 */
export function buildTourEntry(previous, tour, { status, step, steps, now = new Date().toISOString(), restart = false }) {
  const sameRun = !restart && previous?.status === 'in_progress';
  // step 0 = declined without starting (e.g. "Not now" on the page prompt).
  const requested = Number.isFinite(Number(step)) ? Number(step) : 1;
  const reached = Math.max(requested, sameRun ? Number(previous?.step) || 0 : 0);
  return {
    version: tour?.version || 1,
    status,
    at: now,
    step: Math.min(status === 'completed' ? steps : reached, steps) || null,
    steps,
    completedAt: status === 'completed' ? now : (previous?.completedAt || null),
  };
}

export function isAllowedForRole(item, role) {
  return !Array.isArray(item?.roles) || item.roles.length === 0 || item.roles.includes(role);
}

export function filterStepsForRole(steps, role) {
  return (Array.isArray(steps) ? steps : []).filter((step) => isAllowedForRole(step, role));
}

export function filterToursForRole(tours, role) {
  return (Array.isArray(tours) ? tours : [])
    .filter((tour) => isAllowedForRole(tour, role))
    .map((tour) => ({ ...tour, steps: filterStepsForRole(tour.steps, role) }))
    .filter((tour) => tour.steps.length > 0);
}

/** Page tour that belongs to a route (orientation tours only, not guides). */
export function pageTourForPath(tours, pathname) {
  return (Array.isArray(tours) ? tours : []).find((tour) => tour.kind === 'tour' && tour.route === pathname) || null;
}

export function stepIndexById(steps, stepId) {
  return (Array.isArray(steps) ? steps : []).findIndex((step) => step.id === stepId);
}

/** Grows a DOMRect-like box by `pad` and clamps it to the viewport. */
export function padRect(rect, pad, viewport) {
  if (!rect) return null;
  const left = Math.max(0, rect.left - pad);
  const top = Math.max(0, rect.top - pad);
  const right = Math.min(viewport.width, rect.left + rect.width + pad);
  const bottom = Math.min(viewport.height, rect.top + rect.height + pad);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function spaceFor(placement, target, viewport) {
  if (placement === 'bottom') return viewport.height - (target.top + target.height);
  if (placement === 'top') return target.top;
  if (placement === 'right') return viewport.width - (target.left + target.width);
  return target.left;
}

function fits(placement, target, card, viewport, gap, margin) {
  const needed = (placement === 'bottom' || placement === 'top' ? card.height : card.width) + gap + margin;
  return spaceFor(placement, target, viewport) >= needed;
}

/**
 * Positions the tour card next to the (padded) target.
 * Tries the preferred placement first, then bottom → top → right → left, then the side with most room.
 * Without a target the card is centered.
 * @returns {{ top: number, left: number, placement: string, arrowOffset: number|null }}
 */
export function computeCardPosition({ target, card, viewport, preferred = 'bottom', gap = 14, margin = 12 }) {
  if (!target) {
    return {
      top: Math.max(margin, Math.round((viewport.height - card.height) / 2)),
      left: Math.max(margin, Math.round((viewport.width - card.width) / 2)),
      placement: 'center',
      arrowOffset: null,
    };
  }
  const order = [preferred, ...PLACEMENTS.filter((p) => p !== preferred)].filter((p) => PLACEMENTS.includes(p));
  const placement = order.find((p) => fits(p, target, card, viewport, gap, margin))
    || [...PLACEMENTS].sort((a, b) => spaceFor(b, target, viewport) - spaceFor(a, target, viewport))[0];

  const centerX = target.left + target.width / 2;
  const centerY = target.top + target.height / 2;
  let top;
  let left;
  if (placement === 'bottom' || placement === 'top') {
    top = placement === 'bottom' ? target.top + target.height + gap : target.top - gap - card.height;
    left = clamp(centerX - card.width / 2, margin, viewport.width - card.width - margin);
  } else {
    left = placement === 'right' ? target.left + target.width + gap : target.left - gap - card.width;
    top = clamp(centerY - card.height / 2, margin, viewport.height - card.height - margin);
  }
  top = clamp(top, margin, viewport.height - card.height - margin);
  left = clamp(left, margin, viewport.width - card.width - margin);

  const arrowOffset = placement === 'bottom' || placement === 'top'
    ? clamp(centerX - left, 20, card.width - 20)
    : clamp(centerY - top, 20, card.height - 20);

  return { top: Math.round(top), left: Math.round(left), placement, arrowOffset: Math.round(arrowOffset) };
}

/** True when a rect is (at least partially) inside the viewport. */
export function isRectInViewport(rect, viewport) {
  if (!rect) return false;
  return rect.top < viewport.height && rect.left < viewport.width
    && rect.top + rect.height > 0 && rect.left + rect.width > 0;
}

export function rectsDiffer(a, b, tolerance = 0.5) {
  if (!a || !b) return a !== b;
  return Math.abs(a.left - b.left) > tolerance || Math.abs(a.top - b.top) > tolerance
    || Math.abs(a.width - b.width) > tolerance || Math.abs(a.height - b.height) > tolerance;
}

/** Linear interpolation between two rects (spotlight morph). */
export function lerpRect(from, to, t) {
  const k = clamp(t, 0, 1);
  return {
    left: from.left + (to.left - from.left) * k,
    top: from.top + (to.top - from.top) * k,
    width: from.width + (to.width - from.width) * k,
    height: from.height + (to.height - from.height) * k,
  };
}

/** Ease-out curve for JS-driven tweens (close to motion.easeOut). */
export function easeOutCubic(t) {
  const k = clamp(t, 0, 1);
  return 1 - (1 - k) ** 3;
}

/** SVG path: full-viewport rect with a rounded-rect hole (fill-rule evenodd). */
export function spotlightPath(viewport, hole, radius = 10) {
  const outer = `M0 0H${viewport.width}V${viewport.height}H0Z`;
  if (!hole || hole.width <= 0 || hole.height <= 0) return outer;
  const r = Math.min(radius, hole.width / 2, hole.height / 2);
  const x = hole.left;
  const y = hole.top;
  const w = hole.width;
  const h = hole.height;
  const inner = `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}`
    + `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}`
    + `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  return `${outer}${inner}`;
}
