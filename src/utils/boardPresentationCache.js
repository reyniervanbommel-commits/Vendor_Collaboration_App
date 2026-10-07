// Session-scoped cache voor de presentatielaag van een board: saved views (grouping, filters,
// kolomlayout) en board-settings (kolomzichtbaarheid/-volgorde/-breedtes/-stijlen).
//
// Waarom: de board-DATA komt sinds de revision-cache instant uit boardSessionStore, maar de
// presentatie werd nog elke mount opnieuw async opgehaald en landde een tel later — waardoor de
// groepen en kolommen zichtbaar "bijtrokken". Door ook deze payloads per sessie te cachen kunnen
// de hooks hun initiële state ermee seeden, zodat grouping/kolommen al bij de eerste paint staan.
// De achtergrond-refetch (SWR) blijft de bron van waarheid; hij corrigeert alleen bij een echte
// wijziging (en veroorzaakt dan geen zichtbare flits omdat de waarden gelijk zijn).
//
// Alleen in-memory (geen localStorage), gekoppeld aan de tab-sessie — net als boardSessionStore.

const viewsByBoard = new Map();
const settingsByBoard = new Map();
const settingsListeners = new Set();

export function getCachedBoardViews(boardKey) {
  return boardKey && viewsByBoard.has(boardKey) ? viewsByBoard.get(boardKey) : null;
}

export function setCachedBoardViews(boardKey, views) {
  if (!boardKey || !Array.isArray(views)) return;
  viewsByBoard.set(boardKey, views);
}

export function getCachedBoardSettings(boardKey) {
  return boardKey && settingsByBoard.has(boardKey) ? settingsByBoard.get(boardKey) : null;
}

export function setCachedBoardSettings(boardKey, settings) {
  if (!boardKey || !settings || typeof settings !== 'object') return;
  settingsByBoard.set(boardKey, settings);
  settingsListeners.forEach((listener) => listener(boardKey));
}

/** Notified after every settings write (fetch, column prefs, pinned order). Returns unsubscribe. */
export function subscribeBoardSettings(listener) {
  settingsListeners.add(listener);
  return () => settingsListeners.delete(listener);
}

export function clearBoardPresentationCache() {
  viewsByBoard.clear();
  settingsByBoard.clear();
}
