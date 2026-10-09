import { describe, expect, it } from 'vitest';
import {
  ROLES, ROLE_LABELS, STAFF_ROLES, isStaffRole, hasEmployeeAccess, canChooseRemarkVisibility,
} from './roles';

describe('roles (client)', () => {
  it('kent supply_chain met label', () => {
    expect(ROLES.SUPPLY_CHAIN).toBe('supply_chain');
    expect(STAFF_ROLES).toEqual(['admin', 'employee', 'supply_chain']);
    expect(ROLE_LABELS.supply_chain).toBe('Supply Chain');
    expect(ROLE_LABELS.supplier).toBe('Vendor');
  });

  it('helpers', () => {
    expect(isStaffRole('supply_chain')).toBe(true);
    expect(isStaffRole('supplier')).toBe(false);
    expect(hasEmployeeAccess('supply_chain')).toBe(true);
    expect(hasEmployeeAccess('admin')).toBe(false);
    expect(canChooseRemarkVisibility('supply_chain')).toBe(true);
    expect(canChooseRemarkVisibility('employee')).toBe(false);
  });
});
