import React, { useEffect, useRef } from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import { motion, tourLayers } from '../../styles/motionTokens';
import { easeOutCubic, lerpRect, spotlightPath } from '../../utils/tourSteps';
import { keyframes, reducedMotion } from './onboardingMotion';

const useStyles = makeStyles({
  svg: {
    position: 'fixed',
    inset: 0,
    width: '100vw',
    height: '100vh',
    zIndex: tourLayers.overlay,
    pointerEvents: 'none',
    animationName: keyframes.fadeIn,
    animationDuration: `${motion.durationNormal}ms`,
    animationFillMode: 'both',
    ...reducedMotion,
  },
  dim: {
    fill: tokens.colorBackgroundOverlay,
    // Dimmed area blocks clicks; the evenodd hole lets clicks reach the spotlighted element.
    pointerEvents: 'visiblePainted',
    cursor: 'default',
  },
  ring: {
    position: 'fixed',
    zIndex: tourLayers.overlay,
    pointerEvents: 'none',
    borderRadius: '10px',
    outline: `2px solid ${tokens.colorBrandStroke1}`,
    outlineOffset: '0px',
    animationName: keyframes.pulseRing,
    animationDuration: `${motion.pulseLoopMs}ms`,
    animationIterationCount: 'infinite',
    animationTimingFunction: motion.easeStandard,
    transitionProperty: 'opacity',
    transitionDuration: `${motion.durationFast}ms`,
    ...reducedMotion,
  },
});

const RADIUS = 10;

/**
 * Full-screen dim with an animated rounded cut-out around the target. The cut-out morphs between
 * steps with a JS tween (cross-browser; no CSS path animation), written straight to the DOM so a
 * moving target doesn't re-render React every frame.
 */
export default function TourSpotlight({ hole, viewport, reduced, onDimPointerDown }) {
  const styles = useStyles();
  const pathRef = useRef(null);
  const ringRef = useRef(null);
  const shownRef = useRef(null);
  const frameRef = useRef(0);

  useEffect(() => {
    const draw = (rect) => {
      shownRef.current = rect;
      pathRef.current?.setAttribute('d', spotlightPath(viewport, rect, RADIUS));
      const ring = ringRef.current;
      if (!ring) return;
      if (!rect) {
        ring.style.opacity = '0';
        return;
      }
      ring.style.opacity = '1';
      ring.style.left = `${rect.left}px`;
      ring.style.top = `${rect.top}px`;
      ring.style.width = `${rect.width}px`;
      ring.style.height = `${rect.height}px`;
    };

    cancelAnimationFrame(frameRef.current);
    const from = shownRef.current;
    if (!hole || reduced) {
      draw(hole);
      return undefined;
    }
    const start = from || {
      left: hole.left - 48, top: hole.top - 48, width: hole.width + 96, height: hole.height + 96,
    };
    const distance = Math.abs(start.left - hole.left) + Math.abs(start.top - hole.top)
      + Math.abs(start.width - hole.width) + Math.abs(start.height - hole.height);
    // Tracking a scrolling target: snap instead of lagging behind.
    if (from && distance < 6) {
      draw(hole);
      return undefined;
    }
    const startedAt = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - startedAt) / motion.durationSlow);
      draw(lerpRect(start, hole, easeOutCubic(t)));
      if (t < 1) frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [hole, viewport, reduced]);

  return (
    <>
      <svg className={styles.svg} width={viewport.width} height={viewport.height} aria-hidden="true">
        <path
          ref={pathRef}
          className={styles.dim}
          fillRule="evenodd"
          d={spotlightPath(viewport, null)}
          onPointerDown={onDimPointerDown}
        />
      </svg>
      <div ref={ringRef} className={styles.ring} style={{ opacity: 0 }} aria-hidden="true" />
    </>
  );
}
