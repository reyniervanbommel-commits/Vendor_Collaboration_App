import { useCallback, useSyncExternalStore } from 'react';
import { apiRequest } from '../utils/api';
import {
  getCachedBoardSettings,
  setCachedBoardSettings,
  subscribeBoardSettings,
} from '../utils/boardPresentationCache';

const BOARD_KEY = 'purchase-orders';
const EMPTY = [];

function readOrder() {
  const order = getCachedBoardSettings(BOARD_KEY)?.pinnedViewOrder;
  return Array.isArray(order) ? order : EMPTY;
}

function subscribe(onChange) {
  return subscribeBoardSettings((boardKey) => {
    if (boardKey === BOARD_KEY) onChange();
  });
}

/**
 * Per-user order of pinned views, stored in board-settings (`pinnedViewOrder`).
 * Reads from the session cache (filled by the page's board-settings fetch) and updates it
 * optimistically, so the strip reorders instantly and survives remounts.
 */
export function usePinnedViewOrder() {
  const order = useSyncExternalStore(subscribe, readOrder, readOrder);

  const setOrder = useCallback((ids) => {
    const next = ids.map(String);
    setCachedBoardSettings(BOARD_KEY, { ...(getCachedBoardSettings(BOARD_KEY) || {}), pinnedViewOrder: next });
    void apiRequest(`/supplier/board-settings/${BOARD_KEY}`, {
      method: 'PATCH',
      body: { settings: { pinnedViewOrder: next } },
    }).catch(() => {});
  }, []);

  return { order, setOrder };
}
