/** Per-user default stored as `defaultViewId`: a view id, NO_DEFAULT_VIEW (All orders) or null (not chosen). */
export const NO_DEFAULT_VIEW = 'none';

function pickScopeDefault(views, isSupplier) {
  const personalViews = views.filter((view) => view.scope === 'personal');
  const vendorViews = views.filter((view) => view.scope === 'vendor');
  const globalViews = views.filter((view) => view.scope === 'global');

  if (isSupplier) {
    return vendorViews.find((view) => view.isDefault)
      || vendorViews[0]
      || personalViews.find((view) => view.isDefault)
      || personalViews[0]
      || null;
  }

  return personalViews.find((view) => view.isDefault)
    || globalViews.find((view) => view.isDefault)
    || vendorViews.find((view) => view.isDefault)
    || null;
}

/**
 * The view the board opens with. The user's own choice wins; without one (or when that view
 * was deleted) the shared scope defaults apply. Null means All orders.
 */
export function pickStartupView(views, isSupplier, defaultViewId = null) {
  if (defaultViewId === NO_DEFAULT_VIEW) return null;
  if (defaultViewId != null) {
    const chosen = views.find((view) => String(view.id) === String(defaultViewId));
    if (chosen) return chosen;
  }
  return pickScopeDefault(views, isSupplier);
}
