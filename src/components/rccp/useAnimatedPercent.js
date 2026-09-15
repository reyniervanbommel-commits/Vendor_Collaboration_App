import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 400;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Tweens a 0–100 percent value smoothly whenever it changes, so the KPI pie
 * animates instead of snapping when the underlying dataset (table selection,
 * filters, etc.) changes.
 *
 * @param {number|null} target - Percent to animate towards.
 * @returns {number|null} Current (animated) percent value.
 */
export function useAnimatedPercent(target) {
  const [current, setCurrent] = useState(target);
  const frameRef = useRef(null);
  const fromRef = useRef(target);

  useEffect(() => {
    if (target === null || target === undefined) {
      setCurrent(target);
      return undefined;
    }
    const from = fromRef.current ?? target;
    const start = performance.now();

    function step(now) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / DURATION_MS);
      const value = from + (target - from) * easeOutCubic(t);
      setCurrent(value);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
      }
    }

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      fromRef.current = target;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return current;
}

export default useAnimatedPercent;
