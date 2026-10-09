export const VIEW_NAME_MAX_LENGTH = 25;

export function viewShowsAsTab(view) {
  return Boolean(view?.id && view.viewState?.showAsTab);
}
