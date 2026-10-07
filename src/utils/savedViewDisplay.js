export const VIEW_NAME_MAX_LENGTH = 25;

export function truncateViewName(name) {
  const text = String(name || '').trim();
  if (text.length <= VIEW_NAME_MAX_LENGTH) return text;
  return text.slice(0, VIEW_NAME_MAX_LENGTH);
}

export function viewShowsAsTab(view) {
  return Boolean(view?.id && view.viewState?.showAsTab);
}
