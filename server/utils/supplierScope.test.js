'use strict';

const { getSupplierAccount, isStaffUser } = require('./supplierScope');

describe('getSupplierAccount', () => {
  it('gebruikt vendorAccount als het aanwezig is', () => {
    expect(getSupplierAccount({ vendorAccount: ' V000583 ' })).toBe('V000583');
  });

  it('valt terug op supplierAccount', () => {
    expect(getSupplierAccount({ supplierAccount: 'V000696' })).toBe('V000696');
  });

  it('valt terug op vendor_account (snake_case, DB-vorm)', () => {
    expect(getSupplierAccount({ vendor_account: 'V000123' })).toBe('V000123');
  });

  it('geeft voorrang aan het expliciete account boven het e-mail-prefix', () => {
    expect(getSupplierAccount({ vendorAccount: 'V000583', email: 'v000999@example.com' })).toBe('V000583');
  });

  it('valt terug op het local-part van het e-mailadres zonder expliciet account', () => {
    expect(getSupplierAccount({ email: 'v000583@example.com' })).toBe('v000583');
  });

  it('geeft een lege string zonder account en zonder e-mail', () => {
    expect(getSupplierAccount({})).toBe('');
  });

  it('geeft een lege string voor undefined/null user', () => {
    expect(getSupplierAccount(undefined)).toBe('');
    expect(getSupplierAccount(null)).toBe('');
  });
});

describe('isStaffUser', () => {
  it('is true voor admin', () => {
    expect(isStaffUser({ role: 'admin' })).toBe(true);
  });

  it('is true voor employee', () => {
    expect(isStaffUser({ role: 'employee' })).toBe(true);
  });

  it('is false voor supplier', () => {
    expect(isStaffUser({ role: 'supplier' })).toBe(false);
  });

  it('is false zonder user', () => {
    expect(isStaffUser(undefined)).toBe(false);
    expect(isStaffUser(null)).toBe(false);
  });
});

describe('isStaffUser', () => {
  it('telt supply_chain als staff', () => {
    expect(isStaffUser({ role: 'supply_chain' })).toBe(true);
    expect(isStaffUser({ role: 'supplier' })).toBe(false);
  });
});
