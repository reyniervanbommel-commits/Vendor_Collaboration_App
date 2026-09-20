import { describe, expect, it } from 'vitest';
import { ROLES } from '../constants/roles';
import { getUserAccessSummary } from './userAccessSummary';

describe('getUserAccessSummary', () => {
  it('toont een admin als volledig gemachtigd, ook zonder permissierijen', () => {
    const summary = getUserAccessSummary(ROLES.ADMIN, []);
    expect(summary.hasAccess).toBe(true);
    expect(summary.statusLabel).toBe('Full access');
    expect(summary.badges).toEqual(['All settings']);
  });

  it('toont een vendor als vendor-toegang, ongeacht de permissierijen', () => {
    expect(getUserAccessSummary(ROLES.SUPPLIER, []).badges).toEqual(['Purchase orders']);
    expect(getUserAccessSummary(ROLES.SUPPLIER, ['odata']).statusLabel).toBe('Vendor access');
  });

  it('toont voor een employee de toegekende instellingen-tabs in sidebar-volgorde', () => {
    const summary = getUserAccessSummary(ROLES.EMPLOYEE, ['external-links', 'analytics']);
    expect(summary.hasAccess).toBe(true);
    expect(summary.badges).toEqual(['Analytics', 'External links']);
  });

  it('negeert niet-toewijsbare permissies bij een employee', () => {
    const summary = getUserAccessSummary(ROLES.EMPLOYEE, ['purchase-orders', 'admin']);
    expect(summary.hasAccess).toBe(false);
    expect(summary.badges).toEqual([]);
    expect(summary.emptyLabel).toBe('General only');
  });

  it('meldt een employee zonder toekenningen als zonder instellingen-toegang', () => {
    const summary = getUserAccessSummary(ROLES.EMPLOYEE, []);
    expect(summary.statusLabel).toBe('No settings access');
  });
});
