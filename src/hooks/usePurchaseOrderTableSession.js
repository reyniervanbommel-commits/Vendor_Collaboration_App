import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import {
  applyPoTableSessionOverlay,
  clearPoTableSession,
  savePoTableSession,
} from '../utils/poTableSessionState';

/**
 * Houdt unsaved PO-tabel filter/sort/grouping in de tab-sessie (niet in de saved view).
 * @param {{ boardView: object, activeViewId: string|number|null }} args
 */
export function usePurchaseOrderTableSession({ boardView, activeViewId }) {
  const skipPersistRef = useRef(true);
  const suppressNextPersistRef = useRef(false);

  const overlayAfter = useCallback((viewId, apply) => {
    skipPersistRef.current = true;
    apply();
    applyPoTableSessionOverlay(viewId, (snapshot) => {
      boardView.applyFilterSortGrouping(snapshot);
    });
    skipPersistRef.current = false;
  }, [boardView]);

  const restore = useCallback((viewId) => {
    skipPersistRef.current = true;
    applyPoTableSessionOverlay(viewId, (snapshot) => {
      boardView.applyFilterSortGrouping(snapshot);
    });
    skipPersistRef.current = false;
  }, [boardView]);

  const enablePersist = useCallback(() => {
    skipPersistRef.current = false;
  }, []);

  const suppressNextPersist = useCallback(() => {
    suppressNextPersistRef.current = true;
  }, []);

  const clear = useCallback((viewId) => {
    clearPoTableSession(viewId);
  }, []);

  // useLayoutEffect (i.p.v. useEffect): schrijft de snapshot weg vóór de browser de volgende
  // klik/navigatie kan verwerken. Zo kan een filter-wis niet "verliezen" van een snelle
  // tab/view-switch die daarna sessionStorage voor dezelfde view overschrijft (#PO-filter-sticky).
  useLayoutEffect(() => {
    if (skipPersistRef.current) return;
    if (suppressNextPersistRef.current) {
      suppressNextPersistRef.current = false;
      return;
    }
    savePoTableSession(activeViewId, boardView.exportFilterSortGrouping());
  }, [activeViewId, boardView]);

  return useMemo(
    () => ({ overlayAfter, restore, enablePersist, suppressNextPersist, clear }),
    [overlayAfter, restore, enablePersist, suppressNextPersist, clear]
  );
}
