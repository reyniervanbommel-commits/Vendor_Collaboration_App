import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../utils/api';
import {
  EMPTY_ONBOARDING_STATE, applyOnboardingPatch, buildTourEntry, normalizeOnboardingState,
} from '../utils/tourSteps';

const ENDPOINT = '/supplier/board-settings/onboarding';
const STEP_SAVE_DELAY_MS = 2500;

/**
 * Per-user onboarding progress (welcome + tours + guides), stored server-side so it follows the
 * user across browsers. Loads once per user id; writes are optimistic and send only the delta.
 * @param {number|string|null} userId - load only when a user is signed in
 * @returns {{ state: object, loaded: boolean, available: boolean, markWelcomeSeen: () => void,
 *   markTour: (tour, status, progress?) => void, trackTourStep: (tour, step) => void }}
 *   available = the stored state was read successfully (only then may tours open automatically)
 */
export function useOnboardingState(userId) {
  const [state, setState] = useState(EMPTY_ONBOARDING_STATE);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(false);
  const userRef = useRef(userId);
  userRef.current = userId;

  useEffect(() => {
    setState(EMPTY_ONBOARDING_STATE);
    setLoaded(false);
    setAvailable(false);
    if (!userId) return undefined;
    let active = true;
    apiRequest(ENDPOINT)
      .then((data) => {
        if (!active) return;
        setState(normalizeOnboardingState(data?.settings?.onboarding));
        setAvailable(true);
      })
      .catch(() => {
        // Onboarding is optional: when the endpoint fails, never auto-open tours this session
        // (manual start from Guides still works).
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => { active = false; };
  }, [userId]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const stepTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(stepTimerRef.current), []);

  const send = useCallback((delta) => {
    if (!userRef.current) return;
    apiRequest(ENDPOINT, { method: 'PATCH', body: { settings: { onboarding: delta } } }).catch(() => {});
  }, []);

  const applyLocal = useCallback((delta) => {
    stateRef.current = applyOnboardingPatch(stateRef.current, delta);
    setState(stateRef.current);
  }, []);

  const markWelcomeSeen = useCallback(() => {
    const delta = { welcomeSeenAt: new Date().toISOString() };
    applyLocal(delta);
    send(delta);
  }, [applyLocal, send]);

  const tourDelta = useCallback((tour, status, { step = 1, steps, restart = false } = {}) => {
    const total = steps || tour.steps?.length || 1;
    const entry = buildTourEntry(stateRef.current.tours[tour.id], tour, { status, step, steps: total, restart });
    return { tours: { [tour.id]: entry } };
  }, []);

  /** Start / finish / skip: written immediately. progress = { step, steps, restart }. */
  const markTour = useCallback((tour, status, progress) => {
    if (!tour?.id) return;
    clearTimeout(stepTimerRef.current);
    const delta = tourDelta(tour, status, progress);
    applyLocal(delta);
    send(delta);
  }, [applyLocal, send, tourDelta]);

  /** Step reached during a run: updated locally at once, saved at most every few seconds. */
  const trackTourStep = useCallback((tour, step) => {
    if (!tour?.id) return;
    applyLocal(tourDelta(tour, 'in_progress', { step }));
    clearTimeout(stepTimerRef.current);
    stepTimerRef.current = setTimeout(() => {
      const entry = stateRef.current.tours[tour.id];
      if (entry?.status === 'in_progress') send({ tours: { [tour.id]: entry } });
    }, STEP_SAVE_DELAY_MS);
  }, [applyLocal, send, tourDelta]);

  return useMemo(
    () => ({ state, loaded, available, markWelcomeSeen, markTour, trackTourStep }),
    [state, loaded, available, markWelcomeSeen, markTour, trackTourStep],
  );
}
