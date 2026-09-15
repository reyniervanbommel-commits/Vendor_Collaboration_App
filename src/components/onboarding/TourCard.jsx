import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Button,
  Text,
  mergeClasses,
  useUncontrolledFocus,
} from '@fluentui/react-components';
import { ArrowLeft16Regular, ArrowRight16Regular, Dismiss16Regular } from '@fluentui/react-icons';
import { computeCardPosition } from '../../utils/tourSteps';
import { CARD_WIDTH, useTourCardStyles } from './tourCardStyles';

const MAX_DOTS = 10;

function ProgressDots({ styles, index, total }) {
  if (total <= 1) return null;
  return (
    <div className={styles.progress}>
      {total <= MAX_DOTS ? (
        <div className={styles.dots} aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={mergeClasses(styles.dot, i < index && styles.dotDone, i === index && styles.dotActive)}
            />
          ))}
        </div>
      ) : null}
      <span className={styles.counter}>{index + 1} of {total}</span>
    </div>
  );
}

function Arrow({ styles, position }) {
  if (!position || position.placement === 'center' || position.arrowOffset === null) return null;
  const { placement, arrowOffset } = position;
  const cls = {
    bottom: styles.arrowBottom, top: styles.arrowTop, right: styles.arrowRight, left: styles.arrowLeft,
  }[placement];
  const style = placement === 'bottom' || placement === 'top'
    ? { left: `${arrowOffset - 6}px` }
    : { top: `${arrowOffset - 6}px` };
  return <span className={mergeClasses(styles.arrow, cls)} style={style} aria-hidden="true" />;
}

/**
 * Floating tour card. `mode`:
 *  - 'step'    normal step (Next / Done, or a hint for action steps)
 *  - 'paused'  the menu/dialog of the guide was closed → Resume / End
 *  - 'missing' the anchor isn't on screen → Back / Skip step / End
 */
export default function TourCard({
  tour, step, index, total, mode, hole, viewport, nudgeKey, canGoBack,
  onNext, onBack, onClose, onResume,
}) {
  const styles = useTourCardStyles();
  const cardRef = useRef(null);
  const primaryRef = useRef(null);
  const [size, setSize] = useState({ width: CARD_WIDTH, height: 200 });
  const [nudging, setNudging] = useState(false);
  // Keeps focus handling inside the card even while a Fluent modal dialog traps focus.
  const uncontrolledFocus = useUncontrolledFocus();

  const isLast = index >= total - 1;
  const isGuide = tour.kind === 'guide';
  const waitsForUser = mode === 'step' && step.action;
  const titleId = `tour-card-title-${tour.id}`;

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return undefined;
    const measure = () => {
      const next = { width: el.offsetWidth, height: el.offsetHeight };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!nudgeKey) return undefined;
    setNudging(true);
    const timer = setTimeout(() => setNudging(false), 400);
    return () => clearTimeout(timer);
  }, [nudgeKey]);

  useEffect(() => {
    if (!waitsForUser) primaryRef.current?.focus({ preventScroll: true });
  }, [step.id, mode, waitsForUser]);

  const position = computeCardPosition({
    target: mode === 'step' ? hole : null,
    card: size,
    viewport,
    preferred: step.placement || 'bottom',
  });

  let title = step.title;
  let body = step.body;
  if (mode === 'paused') {
    title = 'Guide paused';
    body = 'The menu or dialog closed before the guide was finished. Pick up where you left off, or end the guide.';
  } else if (mode === 'missing') {
    body = step.missingText || 'This part of the screen isn’t available right now. You can skip this step or end the tour.';
  }

  return (
    <div
      ref={cardRef}
      className={mergeClasses(styles.card, nudging && styles.nudge)}
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      {...uncontrolledFocus}
    >
      <div className={styles.surface}>
        <Arrow styles={styles} position={position} />
        <div className={styles.accent} />
        <div className={styles.inner}>
          <div className={styles.eyebrowRow}>
            <span className={styles.eyebrow}>{isGuide ? 'Guide' : 'Tour'} · {tour.title}</span>
            <Button
              appearance="subtle"
              size="small"
              icon={<Dismiss16Regular />}
              aria-label={isGuide ? 'End guide' : 'Close tour'}
              onClick={onClose}
            />
          </div>

          {/* Stable live region; the keyed child re-mounts per step for the crossfade. */}
          <div aria-live="polite">
            <div key={`${step.id}-${mode}`} className={styles.content}>
              <Text id={titleId} className={styles.title}>{title}</Text>
              {body ? <Text className={styles.body}>{body}</Text> : null}
              {mode === 'step' && step.bullets ? (
                <ul className={styles.bullets}>
                  {step.bullets.map((item) => (
                    <li key={item.term} className={styles.bullet}>
                      <span><span className={styles.term}>{item.term}</span> — {item.text}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {mode === 'step' && step.cheatsheet ? (
                <div className={styles.cheatsheet}>
                  {step.cheatsheet.map(([code, text]) => (
                    <React.Fragment key={code}>
                      <code className={styles.code}>{code}</code>
                      <span>{text}</span>
                    </React.Fragment>
                  ))}
                </div>
              ) : null}
              {mode === 'step' && step.example ? (
                <code className={styles.example} aria-label="Example formula">{step.example}</code>
              ) : null}
              {waitsForUser && step.hint ? (
                <span className={styles.hint}>
                  <span className={styles.hintDot} aria-hidden="true" />
                  {step.hint}
                </span>
              ) : null}
            </div>
          </div>

          <div className={styles.footer}>
            <ProgressDots styles={styles} index={index} total={total} />
            <div className={styles.actions}>
              <CardActions
                mode={mode}
                isLast={isLast}
                canGoBack={canGoBack}
                waitsForUser={waitsForUser}
                primaryRef={primaryRef}
                onNext={onNext}
                onBack={onBack}
                onResume={onResume}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardActions({ mode, isLast, canGoBack, waitsForUser, primaryRef, onNext, onBack, onResume }) {
  if (mode === 'paused') {
    // Ending is done with the card's close button (labelled "End guide"), so no duplicate here.
    return <Button ref={primaryRef} appearance="primary" size="small" onClick={onResume}>Resume guide</Button>;
  }
  const back = canGoBack ? (
    <Button appearance="subtle" size="small" icon={<ArrowLeft16Regular />} onClick={onBack}>Back</Button>
  ) : null;
  if (mode === 'missing') {
    return (
      <>
        {back}
        <Button ref={primaryRef} appearance="primary" size="small" onClick={onNext}>
          {isLast ? 'Finish' : 'Skip step'}
        </Button>
      </>
    );
  }
  return (
    <>
      {back}
      {waitsForUser ? null : (
        <Button
          ref={primaryRef}
          appearance="primary"
          size="small"
          icon={isLast ? undefined : <ArrowRight16Regular />}
          iconPosition="after"
          onClick={onNext}
        >
          {isLast ? 'Done' : 'Next'}
        </Button>
      )}
    </>
  );
}
