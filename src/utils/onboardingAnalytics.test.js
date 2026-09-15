import { describe, expect, it } from 'vitest';
import { buildOnboardingOverview, matchesUserSearch, tourProgressForUser } from './onboardingAnalytics';

const tours = [
  { id: 'poBoard', kind: 'tour', version: 1, steps: [{ id: 'a', title: 'Nav' }, { id: 'b', title: 'Views' }, { id: 'c', title: 'Admin only', roles: ['admin'] }] },
  { id: 'guideRccpSettings', kind: 'guide', version: 1, roles: ['admin'], steps: [{ id: 'x', title: 'Open' }, { id: 'y', title: 'Save' }] },
];

describe('tourProgressForUser', () => {
  it('uses the step title of the furthest step', () => {
    const user = { tours: { poBoard: { version: 1, status: 'skipped', step: 2, steps: 3 } } };
    expect(tourProgressForUser(user, tours[0])).toMatchObject({ status: 'skipped', step: 2, steps: 3, stepTitle: 'Views' });
  });
});

describe('buildOnboardingOverview', () => {
  const users = [
    {
      id: 1, email: 'admin@x.nl', role: 'admin', welcomeSeenAt: '2026-09-10T00:00:00.000Z',
      tours: {
        poBoard: { version: 1, status: 'completed', step: 3, steps: 3, at: '2026-09-11T00:00:00.000Z', completedAt: '2026-09-11T00:00:00.000Z' },
        guideRccpSettings: { version: 1, status: 'skipped', step: 1, steps: 2, at: '2026-09-12T00:00:00.000Z' },
      },
    },
    { id: 2, email: 'vendor@x.nl', role: 'supplier', tours: { poBoard: { version: 1, status: 'in_progress', step: 1, steps: 2 } } },
    { id: 3, email: 'new@x.nl', role: 'supplier', tours: {} },
  ];

  it('builds per-user rows with only the tours for that role', () => {
    const { rows } = buildOnboardingOverview(users, tours);
    expect(rows[0].total).toBe(2);
    expect(rows[0].counts).toMatchObject({ completed: 1, skipped: 1 });
    expect(rows[0].lastActivity).toBe('2026-09-12T00:00:00.000Z');
    expect(rows[1].total).toBe(1);
    expect(rows[1].progress[0]).toMatchObject({ status: 'in_progress', steps: 2, stepTitle: 'Nav' });
    expect(rows[2].counts.not_started).toBe(1);
  });

  it('handles missing input', () => {
    expect(buildOnboardingOverview(null, tours)).toEqual({ rows: [] });
  });
});

describe('matchesUserSearch', () => {
  it('matches email, name and vendor account', () => {
    const user = { email: 'Jan@VanBommel.nl', displayName: 'Jan Jansen', vendorAccount: 'V0042' };
    expect(matchesUserSearch(user, '')).toBe(true);
    expect(matchesUserSearch(user, 'vanbommel')).toBe(true);
    expect(matchesUserSearch(user, 'jansen')).toBe(true);
    expect(matchesUserSearch(user, 'v0042')).toBe(true);
    expect(matchesUserSearch(user, 'piet')).toBe(false);
  });
});
