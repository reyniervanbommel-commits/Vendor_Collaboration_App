'use strict';

const ROLES = Object.freeze({
  ADMIN: 'admin',
  EMPLOYEE: 'employee',
  SUPPLY_CHAIN: 'supply_chain',
  SUPPLIER: 'supplier',
});

const ALLOWED_ROLES = Object.freeze(Object.values(ROLES));
// Supply Chain heeft employee-rechten plus de keuze voor remark-zichtbaarheid.
const STAFF_ROLES = Object.freeze([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.SUPPLY_CHAIN]);

function isAllowedRole(role) {
  return ALLOWED_ROLES.includes(role);
}

function isStaffRole(role) {
  return STAFF_ROLES.includes(role);
}

// Rollen met granulaire permissies (dbo.user_permissions).
function hasEmployeeAccess(role) {
  return role === ROLES.EMPLOYEE || role === ROLES.SUPPLY_CHAIN;
}

function canChooseRemarkVisibility(role) {
  return role === ROLES.ADMIN || role === ROLES.SUPPLY_CHAIN;
}

module.exports = {
  ROLES,
  ALLOWED_ROLES,
  STAFF_ROLES,
  isAllowedRole,
  isStaffRole,
  hasEmployeeAccess,
  canChooseRemarkVisibility,
};
