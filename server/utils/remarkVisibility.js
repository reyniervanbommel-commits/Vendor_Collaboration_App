'use strict';

// Zichtbaarheid van remarks. De server bepaalt de waarde; de client mag alleen kiezen als de
// rol dat toestaat (admin, supply_chain). Vendor ziet 'vendor', employee ziet 'internal',
// admin en supply_chain zien alles.
const { ROLES, canChooseRemarkVisibility } = require('../constants/roles');

const REMARK_VISIBILITY = Object.freeze({ VENDOR: 'vendor', INTERNAL: 'internal' });
const VALUES = new Set(Object.values(REMARK_VISIBILITY));

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function resolveWriteVisibility(role, requested) {
  if (role === ROLES.SUPPLIER) return REMARK_VISIBILITY.VENDOR;
  if (role === ROLES.EMPLOYEE) return REMARK_VISIBILITY.INTERNAL;
  if (canChooseRemarkVisibility(role)) {
    if (!VALUES.has(requested)) throw httpError(400, 'Choose who can see this remark');
    return requested;
  }
  throw httpError(403, 'Insufficient permissions');
}

// null = geen filter.
function readVisibilityFilter(role) {
  if (role === ROLES.SUPPLIER) return REMARK_VISIBILITY.VENDOR;
  if (role === ROLES.EMPLOYEE) return REMARK_VISIBILITY.INTERNAL;
  if (canChooseRemarkVisibility(role)) return null;
  throw httpError(403, 'Insufficient permissions');
}

function visibilitySql(alias, filter) {
  return filter ? `AND ${alias}.visibility = @visibility` : '';
}

function canSeeVisibilityDetails(role) {
  return canChooseRemarkVisibility(role);
}

module.exports = {
  REMARK_VISIBILITY,
  canSeeVisibilityDetails,
  readVisibilityFilter,
  resolveWriteVisibility,
  visibilitySql,
};
