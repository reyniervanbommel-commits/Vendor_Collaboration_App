import { describe, expect, it } from 'vitest';
import {
  EMPTY_ONBOARDING_STATE,
  applyOnboardingPatch,
  buildTourEntry,
  computeCardPosition,
  describeTourProgress,
  filterStepsForRole,
  filterToursForRole,
  isRectInViewport,
  isTourDone,
  lerpRect,
  normalizeOnboardingState,
  padRect,
  pageTourForPath,
  rectsDiffer,
  spotlightPath,
} from './tourSteps';

const viewport = { width: 1200, height: 800 };
const card = { width: 320, height: 180 };

describe('onboarding state', () => {
  it('normalizes garbage to the empty state', () => {
    expect(normalizeOnboardingState(null)).toBe(EMPTY_ONBOARDING_STATE);
    expect(normalizeOnboardingState({ tours: { a: { version: 'x' } } })).toEqual({ welcomeSeenAt: null, tours: {} });
  });

  it('applies a patch without dropping other tours', () => {
    const state = { welcomeSeenAt: 'w', tours: { poBoard: { version: 1, status: 'completed' } } };
    const next = applyOnboardingPatch(state, { tours: { rccp: { version: 1, status: 'skipped' } } });
    expect(next.welcomeSeenAt).toBe('w');
    expect(Object.keys(next.tours)).toEqual(['poBoard', 'rccp']);
  });

  it('treats a tour as done only at its current version', () => {
    const state = { tours: { poBoard: { version: 1, status: 'skipped' } } };
    expect(isTourDone(state, { id: 'poBoard', version: 1 })).toBe(true);
    expect(isTourDone(state, { id: 'poBoard', version: 2 })).toBe(false);
    expect(isTourDone(state, { id: 'rccp', version: 1 })).toBe(false);
  });

  it('does not treat an unfinished first run as done, but does a replay', () => {
    const tour = { id: 'poBoard', version: 1 };
    expect(isTourDone({ tours: { poBoard: { version: 1, status: 'in_progress' } } }, tour)).toBe(false);
    expect(isTourDone({ tours: { poBoard: { version: 1, status: 'in_progress', completedAt: 'x' } } }, tour)).toBe(true);
  });

  it('describes progress for display', () => {
    const tour = { id: 'poBoard', version: 2 };
    expect(describeTourProgress(undefined, tour).status).toBe('not_started');
    expect(describeTourProgress({ version: 2, status: 'in_progress', step: 3, steps: 8 }, tour))
      .toMatchObject({ status: 'in_progress', step: 3, steps: 8, outdated: false });
    expect(describeTourProgress({ version: 1, status: 'skipped', completedAt: 'x' }, tour))
      .toMatchObject({ status: 'completed', outdated: true });
  });

  it('builds progress entries that keep the furthest step and earlier completion', () => {
    const tour = { id: 'guideFormula', version: 2 };
    const now = '2026-09-15T10:00:00.000Z';
    const started = buildTourEntry(undefined, tour, { status: 'in_progress', step: 1, steps: 9, now, restart: true });
    expect(started).toEqual({ version: 2, status: 'in_progress', at: now, step: 1, steps: 9, completedAt: null });

    const forward = buildTourEntry(started, tour, { status: 'in_progress', step: 5, steps: 9, now });
    const back = buildTourEntry(forward, tour, { status: 'in_progress', step: 3, steps: 9, now });
    expect(back.step).toBe(5);

    const skipped = buildTourEntry(back, tour, { status: 'skipped', step: 4, steps: 9, now });
    expect(skipped).toMatchObject({ status: 'skipped', step: 5, completedAt: null });

    const done = buildTourEntry(skipped, tour, { status: 'completed', step: 9, steps: 9, now });
    expect(done).toMatchObject({ status: 'completed', step: 9, completedAt: now });

    const replay = buildTourEntry(done, tour, { status: 'in_progress', step: 1, steps: 9, now, restart: true });
    expect(replay).toMatchObject({ status: 'in_progress', step: 1, completedAt: now });
  });
});

describe('role filtering', () => {
  const tours = [
    { id: 'a', kind: 'tour', route: '/', steps: [{ id: 's1' }, { id: 's2', roles: ['admin'] }] },
    { id: 'b', kind: 'guide', roles: ['admin', 'employee'], steps: [{ id: 's1' }] },
    { id: 'c', kind: 'tour', route: '/x', steps: [{ id: 's1', roles: ['admin'] }] },
  ];

  it('removes steps the role may not see', () => {
    expect(filterStepsForRole(tours[0].steps, 'supplier').map((s) => s.id)).toEqual(['s1']);
  });

  it('removes tours the role may not see and tours left without steps', () => {
    expect(filterToursForRole(tours, 'supplier').map((t) => t.id)).toEqual(['a']);
    expect(filterToursForRole(tours, 'admin').map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('finds the page tour by route, never a guide', () => {
    expect(pageTourForPath(tours, '/')?.id).toBe('a');
    expect(pageTourForPath(tours, '/nope')).toBeNull();
  });
});

describe('geometry', () => {
  it('pads and clamps a rect to the viewport', () => {
    expect(padRect({ left: 2, top: 10, width: 20, height: 20 }, 8, viewport))
      .toEqual({ left: 0, top: 2, width: 30, height: 36 });
  });

  it('centers the card without a target', () => {
    expect(computeCardPosition({ target: null, card, viewport })).toEqual({
      top: 310, left: 440, placement: 'center', arrowOffset: null,
    });
  });

  it('uses the preferred placement when it fits', () => {
    const pos = computeCardPosition({ target: { left: 500, top: 100, width: 100, height: 40 }, card, viewport });
    expect(pos.placement).toBe('bottom');
    expect(pos.top).toBe(154);
    expect(pos.left).toBe(390);
    expect(pos.arrowOffset).toBe(160);
  });

  it('flips when the preferred side has no room', () => {
    const pos = computeCardPosition({
      target: { left: 500, top: 700, width: 100, height: 40 }, card, viewport, preferred: 'bottom',
    });
    expect(pos.placement).toBe('top');
  });

  it('places a rail item to the right and keeps the card inside the viewport', () => {
    const pos = computeCardPosition({
      target: { left: 0, top: 780, width: 48, height: 20 }, card, viewport, preferred: 'right',
    });
    expect(pos.placement).toBe('right');
    expect(pos.top + card.height).toBeLessThanOrEqual(viewport.height - 12);
  });

  it('detects viewport overlap and rect changes', () => {
    expect(isRectInViewport({ left: 10, top: -50, width: 10, height: 60 }, viewport)).toBe(true);
    expect(isRectInViewport({ left: 10, top: 900, width: 10, height: 10 }, viewport)).toBe(false);
    expect(rectsDiffer({ left: 0, top: 0, width: 1, height: 1 }, { left: 0.2, top: 0, width: 1, height: 1 })).toBe(false);
    expect(rectsDiffer(null, { left: 0, top: 0, width: 1, height: 1 })).toBe(true);
  });

  it('interpolates rects', () => {
    expect(lerpRect({ left: 0, top: 0, width: 10, height: 10 }, { left: 10, top: 20, width: 30, height: 10 }, 0.5))
      .toEqual({ left: 5, top: 10, width: 20, height: 10 });
  });

  it('builds an evenodd path with a hole only when a hole exists', () => {
    expect(spotlightPath(viewport, null)).toBe('M0 0H1200V800H0Z');
    const path = spotlightPath(viewport, { left: 10, top: 10, width: 100, height: 40 }, 8);
    expect(path.startsWith('M0 0H1200V800H0Z')).toBe(true);
    expect(path).toContain('A8 8');
  });
});
