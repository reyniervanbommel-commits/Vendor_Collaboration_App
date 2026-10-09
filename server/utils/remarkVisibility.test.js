'use strict';

const {
  canSeeVisibilityDetails,
  readVisibilityFilter,
  resolveWriteVisibility,
  visibilitySql,
} = require('./remarkVisibility');

describe('resolveWriteVisibility', () => {
  it('supplier schrijft altijd vendor, ook als client internal stuurt', () => {
    expect(resolveWriteVisibility('supplier', 'internal')).toBe('vendor');
    expect(resolveWriteVisibility('supplier', undefined)).toBe('vendor');
  });

  it('employee schrijft altijd internal, ook als client vendor stuurt', () => {
    expect(resolveWriteVisibility('employee', 'vendor')).toBe('internal');
    expect(resolveWriteVisibility('employee', undefined)).toBe('internal');
  });

  it.each(['admin', 'supply_chain'])('%s moet expliciet kiezen', (role) => {
    expect(resolveWriteVisibility(role, 'vendor')).toBe('vendor');
    expect(resolveWriteVisibility(role, 'internal')).toBe('internal');
    expect(() => resolveWriteVisibility(role, undefined))
      .toThrow(expect.objectContaining({ status: 400, message: 'Choose who can see this remark' }));
    expect(() => resolveWriteVisibility(role, 'public')).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('onbekende rol → 403', () => {
    expect(() => resolveWriteVisibility('user', 'vendor')).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe('readVisibilityFilter', () => {
  it('per rol', () => {
    expect(readVisibilityFilter('supplier')).toBe('vendor');
    expect(readVisibilityFilter('employee')).toBe('internal');
    expect(readVisibilityFilter('supply_chain')).toBeNull();
    expect(readVisibilityFilter('admin')).toBeNull();
  });

  it('onbekende rol → 403', () => {
    expect(() => readVisibilityFilter('user')).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => readVisibilityFilter(undefined)).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe('visibilitySql', () => {
  it('leeg zonder filter, anders predicaat op alias', () => {
    expect(visibilitySql('r', null)).toBe('');
    expect(visibilitySql('r', 'vendor')).toBe('AND r.visibility = @visibility');
  });
});

describe('canSeeVisibilityDetails', () => {
  it('alleen admin en supply_chain', () => {
    expect(['admin', 'supply_chain', 'employee', 'supplier'].map(canSeeVisibilityDetails))
      .toEqual([true, true, false, false]);
  });
});
