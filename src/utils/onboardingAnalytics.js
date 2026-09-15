import { describeTourProgress, filterToursForRole } from './tourSteps';

const STATUS_ORDER = ['completed', 'in_progress', 'skipped', 'not_started'];

/** Progress of one user on one tour, with the title of the furthest step reached. */
export function tourProgressForUser(user, tour) {
  const progress = describeTourProgress(user?.tours?.[tour.id], tour);
  const total = tour.steps.length;
  const step = progress.step ? Math.min(progress.step, total) : null;
  return {
    tour,
    ...progress,
    step,
    steps: total,
    stepTitle: step ? tour.steps[step - 1]?.title || '' : '',
  };
}

function latest(dates) {
  return dates.filter(Boolean).sort().pop() || null;
}

/**
 * Builds the staff overview: one row per user with progress on every tour available to their role.
 * @param {Array} users   rows from GET /admin/analytics/onboarding
 * @param {Array} tours   tour definitions (unfiltered)
 */
export function buildOnboardingOverview(users, tours) {
  const safeUsers = Array.isArray(users) ? users : [];
  const rows = safeUsers.map((user) => {
    const available = filterToursForRole(tours, user.role);
    const progress = available.map((tour) => tourProgressForUser(user, tour));
    const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
    progress.forEach((entry) => { counts[entry.status] += 1; });
    return {
      user,
      progress,
      counts,
      total: progress.length,
      lastActivity: latest([user.welcomeSeenAt, ...progress.map((entry) => entry.at)]),
    };
  });

  return { rows };
}

/** Case-insensitive match on email, name or vendor account. */
export function matchesUserSearch(user, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  return [user?.email, user?.displayName, user?.vendorAccount]
    .some((value) => String(value || '').toLowerCase().includes(needle));
}
