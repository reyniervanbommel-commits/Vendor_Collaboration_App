'use strict';

/**
 * Onboarding-voortgang per gebruiker (product tours + how-to guides).
 * Opgeslagen in user_board_settings (board_key `onboarding`) onder de sleutel `onboarding`.
 * Vorm: { welcomeSeenAt: ISO|null, tours: { [tourId]: { version, status, at, step, steps, completedAt } } }
 *   status      'in_progress' | 'completed' | 'skipped'
 *   step/steps  hoogste bereikte stap (1-based) van het aantal stappen voor de rol van de gebruiker
 *   completedAt blijft staan als een eerder afgeronde tour later opnieuw wordt gestart
 * Tour-ids zijn gewhitelist zodat de client geen willekeurige sleutels kan opslaan.
 */

const ONBOARDING_BOARD_KEY = 'onboarding';

const ONBOARDING_TOUR_IDS = Object.freeze([
  'poBoard',
  'rccp',
  'settings',
  'guideViewTabs',
  'guideAddColumn',
  'guideFormula',
  'guideDatePeriod',
  'guideRccpSettings',
  'guideCellActions',
  'guideRemarks',
  'guideRemarksColumn',
  'guideConditionalFormatting',
  'guideBoardInsights',
]);
const TOUR_STATUSES = new Set(['in_progress', 'completed', 'skipped']);
const MAX_TOUR_VERSION = 1000;
const MAX_STEPS = 100;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeIsoDate(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function normalizeStepCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= MAX_STEPS ? number : null;
}

function normalizeTourEntry(entry) {
  if (!isPlainObject(entry)) return null;
  const version = Number(entry.version);
  if (!Number.isInteger(version) || version < 1 || version > MAX_TOUR_VERSION) return null;
  if (!TOUR_STATUSES.has(entry.status)) return null;
  const steps = normalizeStepCount(entry.steps);
  const step = normalizeStepCount(entry.step);
  return {
    version,
    status: entry.status,
    at: normalizeIsoDate(entry.at),
    step: step && steps ? Math.min(step, steps) : step,
    steps,
    completedAt: normalizeIsoDate(entry.completedAt),
  };
}

function parseSettingsJson(json) {
  if (typeof json !== 'string' || !json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Shapes one users ⟕ user_board_settings row for the staff analytics overview. */
function buildOnboardingProgressRow(row) {
  const onboarding = normalizeOnboarding(parseSettingsJson(row?.settings_json)?.onboarding);
  return {
    id: row?.id,
    email: row?.email || '',
    displayName: row?.display_name || '',
    role: row?.role || '',
    vendorAccount: row?.vendor_account || '',
    welcomeSeenAt: onboarding?.welcomeSeenAt || null,
    tours: onboarding?.tours || {},
  };
}

function normalizeTours(tours) {
  const out = {};
  if (!isPlainObject(tours)) return out;
  ONBOARDING_TOUR_IDS.forEach((id) => {
    const entry = normalizeTourEntry(tours[id]);
    if (entry) out[id] = entry;
  });
  return out;
}

/** Returns null when nothing valid is stored, so other boards don't carry an empty object. */
function normalizeOnboarding(value) {
  if (!isPlainObject(value)) return null;
  const welcomeSeenAt = normalizeIsoDate(value.welcomeSeenAt);
  const tours = normalizeTours(value.tours);
  if (!welcomeSeenAt && Object.keys(tours).length === 0) return null;
  return { welcomeSeenAt, tours };
}

/** Deep-merges a PATCH delta so one tour update never wipes the others. */
function mergeOnboarding(existing, patch) {
  const base = normalizeOnboarding(existing) || { welcomeSeenAt: null, tours: {} };
  if (!isPlainObject(patch)) return normalizeOnboarding(base);
  return normalizeOnboarding({
    welcomeSeenAt: patch.welcomeSeenAt !== undefined ? patch.welcomeSeenAt : base.welcomeSeenAt,
    tours: { ...base.tours, ...(isPlainObject(patch.tours) ? patch.tours : {}) },
  });
}

module.exports = {
  ONBOARDING_BOARD_KEY,
  ONBOARDING_TOUR_IDS,
  normalizeOnboarding,
  mergeOnboarding,
  buildOnboardingProgressRow,
};
