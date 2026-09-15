'use strict';

const { normalizeOnboarding, mergeOnboarding, buildOnboardingProgressRow } = require('./onboardingSettings');

const entry = (overrides) => ({ step: null, steps: null, completedAt: null, at: null, ...overrides });

describe('normalizeOnboarding', () => {
  it('returns null for missing or empty input', () => {
    expect(normalizeOnboarding(undefined)).toBeNull();
    expect(normalizeOnboarding([])).toBeNull();
    expect(normalizeOnboarding({ tours: {} })).toBeNull();
  });

  it('keeps whitelisted tours with valid version, status and progress', () => {
    const result = normalizeOnboarding({
      welcomeSeenAt: '2026-09-15T08:00:00.000Z',
      tours: {
        poBoard: { version: 1, status: 'completed', at: '2026-09-15T08:05:00Z', step: 8, steps: 8, completedAt: '2026-09-15T08:05:00Z' },
        rccp: { version: 2, status: 'skipped' },
        guideFormula: { version: 1, status: 'in_progress', step: 3, steps: 9 },
      },
    });
    expect(result).toEqual({
      welcomeSeenAt: '2026-09-15T08:00:00.000Z',
      tours: {
        poBoard: entry({
          version: 1, status: 'completed', at: '2026-09-15T08:05:00.000Z', step: 8, steps: 8, completedAt: '2026-09-15T08:05:00.000Z',
        }),
        rccp: entry({ version: 2, status: 'skipped' }),
        guideFormula: entry({ version: 1, status: 'in_progress', step: 3, steps: 9 }),
      },
    });
  });

  it('drops unknown tour ids, bad statuses, bad versions and bad dates, and clamps steps', () => {
    const result = normalizeOnboarding({
      welcomeSeenAt: 'not a date',
      tours: {
        hacker: { version: 1, status: 'completed' },
        poBoard: { version: 0, status: 'completed' },
        rccp: { version: 1, status: 'done' },
        settings: { version: '3', status: 'completed', at: '<script>', step: 12, steps: 4 },
        guideRemarks: { version: 1, status: 'skipped', step: -1, steps: 5000 },
      },
    });
    expect(result).toEqual({
      welcomeSeenAt: null,
      tours: {
        settings: entry({ version: 3, status: 'completed', step: 4, steps: 4 }),
        guideRemarks: entry({ version: 1, status: 'skipped' }),
      },
    });
  });
});

describe('mergeOnboarding', () => {
  const existing = {
    welcomeSeenAt: '2026-09-01T00:00:00.000Z',
    tours: { poBoard: entry({ version: 1, status: 'completed' }) },
  };

  it('adds a tour without removing the others', () => {
    const merged = mergeOnboarding(existing, { tours: { rccp: { version: 1, status: 'skipped' } } });
    expect(Object.keys(merged.tours).sort()).toEqual(['poBoard', 'rccp']);
    expect(merged.welcomeSeenAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('sets welcomeSeenAt on first write', () => {
    const merged = mergeOnboarding(null, { welcomeSeenAt: '2026-09-15T10:00:00Z' });
    expect(merged).toEqual({ welcomeSeenAt: '2026-09-15T10:00:00.000Z', tours: {} });
  });

  it('keeps existing state when the patch is not an object', () => {
    expect(mergeOnboarding(existing, 'x')).toEqual(existing);
  });
});

describe('buildOnboardingProgressRow', () => {
  it('shapes a user without onboarding state', () => {
    expect(buildOnboardingProgressRow({ id: 3, email: 'a@b.nl', display_name: 'A', role: 'employee', settings_json: null }))
      .toEqual({ id: 3, email: 'a@b.nl', displayName: 'A', role: 'employee', vendorAccount: '', welcomeSeenAt: null, tours: {} });
  });

  it('parses and normalizes stored progress, ignoring broken JSON', () => {
    const row = buildOnboardingProgressRow({
      id: 4,
      email: 'v@x.nl',
      role: 'supplier',
      vendor_account: 'V001',
      settings_json: JSON.stringify({ onboarding: { tours: { poBoard: { version: 1, status: 'in_progress', step: 2, steps: 8 }, nope: {} } } }),
    });
    expect(row.vendorAccount).toBe('V001');
    expect(row.tours).toEqual({ poBoard: entry({ version: 1, status: 'in_progress', step: 2, steps: 8 }) });
    expect(buildOnboardingProgressRow({ id: 5, settings_json: '{broken' }).tours).toEqual({});
  });
});
