import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Meet de gerenderde hoogte (px) van een element via ResizeObserver — voor lay-outbeslissingen
 * die van de *beschikbare* hoogte afhangen (bv. hoeveel kolommen passen er), niet van de
 * content-hoogte zelf.
 *
 * @returns {{ ref: (node: HTMLElement|null) => void, height: number }}
 */
export function useElementHeight() {
  const [height, setHeight] = useState(0);
  const observerRef = useRef(null);

  const ref = useCallback((node) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node || typeof ResizeObserver === 'undefined') return;
    setHeight(node.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { ref, height };
}
