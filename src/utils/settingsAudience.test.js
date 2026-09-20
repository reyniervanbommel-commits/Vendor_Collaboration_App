import { describe, expect, it } from 'vitest';
import { ROLES } from '../constants/roles';
import {
  GRANTABLE_SETTINGS_TAB_IDS,
  SETTINGS_AUDIENCE,
  canSeeSettingsTab,
  formatAudience,
  getGrantableSettingsSections,
  getVisibleSettingsSections,
} from './settingsAudience';

describe('settingsAudience', () => {
  it('labels vendor as Vendor', () => {
    expect(formatAudience(SETTINGS_AUDIENCE.ALL)).toBe('Admin, Employee, Vendor');
    expect(formatAudience(SETTINGS_AUDIENCE.STAFF)).toBe('Admin, Employee');
    expect(formatAudience(SETTINGS_AUDIENCE.ADMIN)).toBe('Admin');
  });

  it('shows only General to vendors', () => {
    const sections = getVisibleSettingsSections(ROLES.SUPPLIER);
    expect(sections).toHaveLength(1);
    expect(sections[0].items.map((item) => item.id)).toEqual(['general']);
  });

  it('shows an employee without permissions only the non-grantable General tab', () => {
    const ids = getVisibleSettingsSections(ROLES.EMPLOYEE).flatMap((section) => section.items.map((item) => item.id));
    expect(ids).toEqual(['general']);
  });

  it('shows an employee exactly the tabs that were granted', () => {
    const ids = getVisibleSettingsSections(ROLES.EMPLOYEE, ['odata', 'external-links'])
      .flatMap((section) => section.items.map((item) => item.id));
    expect(ids).toEqual(['general', 'odata', 'external-links']);
  });

  it('ignores permissions for vendors', () => {
    const ids = getVisibleSettingsSections(ROLES.SUPPLIER, ['odata'])
      .flatMap((section) => section.items.map((item) => item.id));
    expect(ids).toEqual(['general']);
  });

  it('lets admins see every tab without permissions', () => {
    const ids = getVisibleSettingsSections(ROLES.ADMIN).flatMap((section) => section.items.map((item) => item.id));
    expect(ids).toContain('d365-refresh');
    expect(ids).toContain('track-changes');
    expect(ids).toContain('users');
    expect(ids).toContain('general');
  });

  it('exposes the eight grantable settings tabs', () => {
    expect(GRANTABLE_SETTINGS_TAB_IDS).toEqual([
      'users',
      'analytics',
      'mail-template',
      'odata',
      'datamodel',
      'external-links',
      'track-changes',
      'd365-refresh',
    ]);
    expect(GRANTABLE_SETTINGS_TAB_IDS).not.toContain('general');
  });

  it('groups grantable tabs per section for the permissions dialog', () => {
    const sections = getGrantableSettingsSections();
    expect(sections.map((section) => section.id)).toEqual(['people', 'data']);
    expect(sections[0].items.map((item) => item.id)).toEqual(['users', 'analytics', 'mail-template']);
  });

  it('keeps an admin-only tab invisible for a plain role check', () => {
    expect(canSeeSettingsTab(SETTINGS_AUDIENCE.ADMIN, ROLES.EMPLOYEE)).toBe(false);
    expect(canSeeSettingsTab(SETTINGS_AUDIENCE.ALL, ROLES.SUPPLIER)).toBe(true);
  });
});
