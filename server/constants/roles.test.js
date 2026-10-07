'use strict';

const {
  ROLES, ALLOWED_ROLES, STAFF_ROLES, isStaffRole, hasEmployeeAccess, canChooseRemarkVisibility,
} = require('./roles');

describe('roles', () => {
  it('kent supply_chain als toegestane staff-rol', () => {
    expect(ROLES.SUPPLY_CHAIN).toBe('supply_chain');
    expect(ALLOWED_ROLES).toContain('supply_chain');
    expect(STAFF_ROLES).toEqual(['admin', 'employee', 'supply_chain']);
  });

  it('isStaffRole', () => {
    expect(['admin', 'employee', 'supply_chain'].map(isStaffRole)).toEqual([true, true, true]);
    expect(isStaffRole('supplier')).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });

  it('hasEmployeeAccess geldt voor employee en supply_chain', () => {
    expect(hasEmployeeAccess('employee')).toBe(true);
    expect(hasEmployeeAccess('supply_chain')).toBe(true);
    expect(hasEmployeeAccess('admin')).toBe(false);
    expect(hasEmployeeAccess('supplier')).toBe(false);
  });

  it('canChooseRemarkVisibility alleen admin en supply_chain', () => {
    expect(canChooseRemarkVisibility('admin')).toBe(true);
    expect(canChooseRemarkVisibility('supply_chain')).toBe(true);
    expect(canChooseRemarkVisibility('employee')).toBe(false);
    expect(canChooseRemarkVisibility('supplier')).toBe(false);
  });
});
