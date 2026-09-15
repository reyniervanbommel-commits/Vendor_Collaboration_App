import { useEffect, useRef, useState } from 'react';
import { isRectInViewport, rectsDiffer } from '../utils/tourSteps';

const QUERY_INTERVAL_MS = 200;

/** Visible = connected, has a box, not inside an inert (keep-alive hidden) page. */
export function isElementVisible(el) {
  if (!el || !el.isConnected) return false;
  if (el.closest('[inert]')) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function findVisibleElement(selector) {
  if (!selector || typeof document === 'undefined') return null;
  let nodes;
  try {
    nodes = document.querySelectorAll(selector);
  } catch {
    return null;
  }
  for (const node of nodes) {
    if (isElementVisible(node)) return node;
  }
  return null;
}

function toRect(domRect) {
  return { left: domRect.left, top: domRect.top, width: domRect.width, height: domRect.height };
}

const IDLE = { element: null, rect: null, status: 'idle' };
const SEARCHING = { element: null, rect: null, status: 'searching' };

/**
 * Tracks a tour anchor: waits for it to appear (menus, dialogs, lazy pages), follows its position
 * every frame (scroll, resize, drawer slide-in) and reports when it disappears again.
 * Only runs while a tour step is active, so the board pays nothing otherwise.
 *
 * status: 'idle' | 'searching' | 'found' | 'missing' (never appeared within timeout) | 'lost' (was found, now gone)
 */
export function useTourAnchor(selector, { enabled = true, timeoutMs = 4000, lostMs = 450, resetKey = '' } = {}) {
  const [anchor, setAnchor] = useState(IDLE);
  const anchorRef = useRef(IDLE);
  const active = Boolean(enabled && selector);
  const trackingKey = `${resetKey}|${selector || ''}|${active}`;

  useEffect(() => {
    const publish = (next) => {
      const prev = anchorRef.current;
      const same = prev.key === trackingKey && prev.status === next.status
        && prev.element === next.element && !rectsDiffer(prev.rect, next.rect);
      if (same) return;
      anchorRef.current = { ...next, key: trackingKey };
      setAnchor(anchorRef.current);
    };

    if (!enabled || !selector) {
      publish(IDLE);
      return undefined;
    }

    publish({ element: null, rect: null, status: 'searching' });
    const startedAt = performance.now();
    let element = null;
    let everFound = false;
    let goneSince = null;
    let lastQueryAt = -Infinity;
    let scrolled = false;
    let frame = 0;

    const tick = (now) => {
      if (!isElementVisible(element) && now - lastQueryAt >= QUERY_INTERVAL_MS) {
        lastQueryAt = now;
        element = findVisibleElement(selector);
      }

      if (isElementVisible(element)) {
        goneSince = null;
        everFound = true;
        const rect = toRect(element.getBoundingClientRect());
        if (!scrolled) {
          scrolled = true;
          const viewport = { width: window.innerWidth, height: window.innerHeight };
          if (!isRectInViewport(rect, viewport) && typeof element.scrollIntoView === 'function') {
            element.scrollIntoView({ block: 'center', inline: 'nearest' });
          }
        }
        publish({ element, rect, status: 'found' });
      } else if (everFound) {
        if (goneSince === null) goneSince = now;
        if (now - goneSince >= lostMs) publish({ element: null, rect: null, status: 'lost' });
      } else if (now - startedAt >= timeoutMs) {
        publish({ element: null, rect: null, status: 'missing' });
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [selector, enabled, timeoutMs, lostMs, trackingKey]);

  // Until the effect has run for a new step, never hand out the previous step's status
  // (a stale 'missing' or 'lost' would skip or pause the new step).
  if (anchor.key !== trackingKey) {
    return active ? SEARCHING : IDLE;
  }
  return anchor;
}
