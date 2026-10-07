export const ROLES = Object.freeze({
  ADMIN: 'admin',
  EMPLOYEE: 'employee',
  SUPPLY_CHAIN: 'supply_chain',
  SUPPLIER: 'supplier',
});

// Supply Chain heeft employee-rechten plus de keuze voor remark-zichtbaarheid.
export const STAFF_ROLES = Object.freeze([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.SUPPLY_CHAIN]);

export const ROLE_LABELS = Object.freeze({
  [ROLES.ADMIN]: 'Admin',
  [ROLES.EMPLOYEE]: 'Employee',
  [ROLES.SUPPLY_CHAIN]: 'Supply Chain',
  [ROLES.SUPPLIER]: 'Vendor',
});

export function isStaffRole(role) {
  return STAFF_ROLES.includes(role);
}

// Rollen met granulaire permissies (dbo.user_permissions).
export function hasEmployeeAccess(role) {
  return role === ROLES.EMPLOYEE || role === ROLES.SUPPLY_CHAIN;
}

export function canChooseRemarkVisibility(role) {
  return role === ROLES.ADMIN || role === ROLES.SUPPLY_CHAIN;
}
