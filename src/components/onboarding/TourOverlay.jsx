import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Portal } from '@fluentui/react-components';
import { setVirtualParent } from '@fluentui/react-utilities';
import { findVisibleElement, useTourAnchor } from '../../hooks/useTourAnchor';
import { prefersReducedMotion } from '../../styles/motionTokens';
import { padRect, stepIndexById } from '../../utils/tourSteps';
import TourCard from './TourCard';
import TourSpotlight from './TourSpotlight';
import { useTourPortalStyles, useTourRevealStyles } from './onboardingMotion';

const APPEAR_POLL_MS = 150;
const ACTIVATE_TIMEOUT_MS = 3000;
const FLUENT_OVERLAY_SELECTOR = '.fui-DialogSurface, .fui-MenuPopover, .fui-PopoverSurface, .fui-OverlayDrawer';

function useViewport() {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [viewport, setViewport] = useState(read);
  useEffect(() => {
    const onResize = () => setViewport(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return viewport;
}

function isTypingTarget(target) {
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
}

/**
 * Runs one active tour: resolves the step's anchor, draws the spotlight + card and handles
 * interactive steps (advance on click / appear / disappear, pause when a menu closes).
 */
export default function TourOverlay({ tour, stepIndex, direction, onGoTo, onFinish, onExit }) {
  useTourRevealStyles();
  const portalStyles = useTourPortalStyles();
  const viewport = useViewport();
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const [nudgeKey, setNudgeKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const advancedRef = useRef(false);

  const { steps } = tour;
  const step = steps[stepIndex];
  const total = steps.length;

  const anchor = useTourAnchor(step?.anchor, {
    enabled: Boolean(step?.anchor) && !paused,
    timeoutMs: step?.optional ? 1000 : 4000,
    resetKey: `${tour.id}:${stepIndex}`,
  });

  const goNext = useCallback(() => {
    if (advancedRef.current) return;
    advancedRef.current = true;
    if (stepIndex >= total - 1) onFinish();
    else onGoTo(stepIndex + 1, 1);
  }, [onFinish, onGoTo, stepIndex, total]);

  const goBack = useCallback(() => {
    if (stepIndex > 0) onGoTo(stepIndex - 1, -1);
  }, [onGoTo, stepIndex]);

  const resume = useCallback(() => {
    setPaused(false);
    const target = stepIndexById(steps, step?.resumeTo);
    onGoTo(target >= 0 ? target : 0, -1);
  }, [onGoTo, step, steps]);

  // New step → reset per-step flags.
  useEffect(() => {
    advancedRef.current = false;
    setPaused(false);
  }, [stepIndex, tour.id]);

  // Optional steps whose anchor isn't on screen are skipped in the direction of travel.
  useEffect(() => {
    if (!step?.optional || anchor.status !== 'missing') return;
    if (direction < 0 && stepIndex > 0) onGoTo(stepIndex - 1, -1);
    else goNext();
  }, [anchor.status, direction, goNext, onGoTo, step, stepIndex]);

  // Anchor vanished after being shown: advance, pause, or fall back to the missing card.
  useEffect(() => {
    if (anchor.status !== 'lost' || !step) return;
    if (step.advanceOn?.disappears) goNext();
    else if (step.resumeTo) setPaused(true);
  }, [anchor.status, goNext, step]);

  // advanceOn.appears — e.g. a menu item or dialog showing up after the user clicked.
  useEffect(() => {
    const selector = step?.advanceOn?.appears;
    if (!selector) return undefined;
    const timer = setInterval(() => {
      if (findVisibleElement(selector)) goNext();
    }, APPEAR_POLL_MS);
    return () => clearInterval(timer);
  }, [goNext, step]);

  // advanceOn.click — capture phase so it runs before the app handles (and maybe unmounts) the target.
  useEffect(() => {
    const selector = step?.advanceOn?.click;
    if (!selector) return undefined;
    let timer = 0;
    const onClick = (event) => {
      if (event.target?.closest?.(selector)) timer = window.setTimeout(goNext, 60);
    };
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.clearTimeout(timer);
    };
  }, [goNext, step]);

  // activate — the engine opens something itself, e.g. a tab inside the RCCP settings drawer.
  useEffect(() => {
    const selector = step?.activate;
    if (!selector) return undefined;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const el = findVisibleElement(selector);
      if (el) {
        // Don't toggle an already selected tab or an already open popover closed again.
        const alreadyActive = el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-expanded') === 'true';
        if (!alreadyActive) el.click();
        clearInterval(timer);
      } else if (Date.now() - startedAt > ACTIVATE_TIMEOUT_MS) {
        clearInterval(timer);
      }
    }, APPEAR_POLL_MS);
    return () => clearInterval(timer);
  }, [step]);

  // reveal — keep hover-only controls in the anchor's header cell visible.
  useEffect(() => {
    if (!step?.reveal || !anchor.element) return undefined;
    const host = anchor.element.closest('th') || anchor.element.parentElement;
    host?.setAttribute('data-tour-reveal', 'true');
    return () => host?.removeAttribute('data-tour-reveal');
  }, [anchor.element, step]);

  // Keyboard: ←/→ navigate info steps, Esc ends the tour. Capture phase, so we still see an open
  // Fluent menu/dialog/popover before Fluent closes it — those keys then belong to that overlay.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (isTypingTarget(event.target)) return;
      if (document.querySelector(FLUENT_OVERLAY_SELECTOR)) return;
      if (event.key === 'Escape') {
        onExit();
      } else if (event.key === 'ArrowRight' && !step?.action && !paused) {
        goNext();
      } else if (event.key === 'ArrowLeft' && stepIndex > 0 && !steps[stepIndex - 1]?.action) {
        goBack();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [goBack, goNext, onExit, paused, step, stepIndex, steps]);

  const hole = useMemo(() => {
    if (paused || anchor.status !== 'found' || !anchor.rect) return null;
    return padRect(anchor.rect, step?.padding ?? 6, viewport);
  }, [anchor.rect, anchor.status, paused, step, viewport]);

  const handleDimPointerDown = useCallback(() => setNudgeKey((key) => key + 1), []);
  const lastCardRef = useRef(null);
  const layerRef = useRef(null);

  // Fluent closes a menu/popover on any click "outside" it — including a click on the tour card, which
  // would also unmount a dialog opened from that popover (e.g. the formatting rules). Making the tour
  // layer a virtual child of the spotlighted element lets Fluent treat card clicks as inside.
  useEffect(() => {
    const layer = layerRef.current;
    setVirtualParent(layer, anchor.element || undefined);
    return () => setVirtualParent(layer, undefined);
  }, [anchor.element]);

  if (!step) return null;

  let mode = 'step';
  if (paused) mode = 'paused';
  else if (step.anchor && (anchor.status === 'missing' || anchor.status === 'lost') && !step.optional) mode = 'missing';
  // Still resolving the anchor (page loading, menu opening, optional step about to be skipped):
  // keep showing the previous card so it glides to the new spot instead of blinking.
  const resolving = Boolean(step.anchor) && !paused
    && (anchor.status === 'searching' || (step.optional && anchor.status !== 'found'));

  if (!resolving) {
    lastCardRef.current = {
      tour,
      step,
      index: stepIndex,
      total,
      mode,
      hole,
      // Going back into an action step would reopen a closed menu; only allow Back to info steps.
      canGoBack: stepIndex > 0 && !steps[stepIndex - 1]?.action,
    };
  }
  const card = lastCardRef.current;

  return (
    <Portal mountNode={{ className: portalStyles.mountNode }}>
      <div ref={layerRef}>
        <TourSpotlight
          hole={card ? card.hole : hole}
          viewport={viewport}
          reduced={reduced}
          onDimPointerDown={handleDimPointerDown}
        />
        {card ? (
          <TourCard
            {...card}
            viewport={viewport}
            nudgeKey={nudgeKey}
            onNext={goNext}
            onBack={goBack}
            onClose={onExit}
            onResume={resume}
          />
        ) : null}
      </div>
    </Portal>
  );
}
