import { ROLES } from '../constants/roles';

export const SETTINGS_AUDIENCE = Object.freeze({
  ALL: Object.freeze([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.SUPPLIER]),
  STAFF: Object.freeze([ROLES.ADMIN, ROLES.EMPLOYEE]),
  ADMIN: Object.freeze([ROLES.ADMIN]),
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.ADMIN]: 'Admin',
  [ROLES.EMPLOYEE]: 'Employee',
  [ROLES.SUPPLIER]: 'Vendor',
});

// `grantable`: de tab kan per employee worden vrijgegeven via dbo.user_permissions (#AB:326).
// `general` is niet grantable en blijft daarmee altijd zichtbaar voor iedereen die het bereikt.
export const SETTINGS_NAV_SECTIONS = Object.freeze([
  {
    id: 'app',
    heading: 'App',
    items: Object.freeze([
      { id: 'general', label: 'General', roles: SETTINGS_AUDIENCE.ALL, grantable: false },
    ]),
  },
  {
    id: 'people',
    heading: 'People',
    items: Object.freeze([
      { id: 'users', label: 'Users', roles: SETTINGS_AUDIENCE.ADMIN, grantable: true },
      { id: 'analytics', label: 'Analytics', roles: SETTINGS_AUDIENCE.STAFF, grantable: true },
      { id: 'mail-template', label: 'Mail template', roles: SETTINGS_AUDIENCE.ADMIN, grantable: true },
    ]),
  },
  {
    id: 'data',
    heading: 'Data',
    items: Object.freeze([
      { id: 'odata', label: 'OData', roles: SETTINGS_AUDIENCE.ADMIN, grantable: true },
      { id: 'datamodel', label: 'Data model', roles: SETTINGS_AUDIENCE.ADMIN, grantable: true },
      { id: 'external-links', label: 'External links', roles: SETTINGS_AUDIENCE.STAFF, grantable: true },
      { id: 'track-changes', label: 'Track changes', roles: SETTINGS_AUDIENCE.ADMIN, grantable: true },
      { id: 'd365-refresh', label: 'D365 refresh', roles: SETTINGS_AUDIENCE.ADMIN, grantable: true },
    ]),
  },
]);

export const GRANTABLE_SETTINGS_TAB_IDS = Object.freeze(
  SETTINGS_NAV_SECTIONS.flatMap((section) => section.items.filter((item) => item.grantable).map((item) => item.id))
);

/**
 * @param {string[]} roles
 * @returns {string}
 */
export function formatAudience(roles) {
  const list = Array.isArray(roles) ? roles : [];
  return list.map((role) => ROLE_LABELS[role] || role).join(', ');
}

/**
 * @param {string[]} tabRoles
 * @param {string} [userRole]
 * @returns {boolean}
 */
export function canSeeSettingsTab(tabRoles, userRole) {
  return Array.isArray(tabRoles) && tabRoles.includes(userRole);
}

/**
 * Zichtbaarheidsregel per tab: admin ziet alles, een employee ziet een grantable tab alleen met
 * de bijbehorende permissie, en niet-grantable tabs volgen puur de rollenlijst (huidig gedrag).
 * @param {{ id: string, roles: string[], grantable?: boolean }} item
 * @param {string} [userRole]
 * @param {string[]} [userPermissions]
 * @returns {boolean}
 */
export function canAccessSettingsTab(item, userRole, userPermissions = []) {
  if (userRole === ROLES.ADMIN) return true;
  if (!item.grantable) return canSeeSettingsTab(item.roles, userRole);
  if (userRole !== ROLES.EMPLOYEE) return false;
  return Array.isArray(userPermissions) && userPermissions.includes(item.id);
}

/**
 * @param {string} [userRole]
 * @param {string[]} [userPermissions]
 * @returns {{ id: string, heading: string, items: { id: string, label: string, roles: string[], grantable: boolean }[] }[]}
 */
export function getVisibleSettingsSections(userRole, userPermissions = []) {
  return SETTINGS_NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessSettingsTab(item, userRole, userPermissions)),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * Secties met alleen de per-employee toewijsbare tabs, voor de permissiedialoog.
 * @returns {{ id: string, heading: string, items: { id: string, label: string }[] }[]}
 */
export function getGrantableSettingsSections() {
  return SETTINGS_NAV_SECTIONS
    .map((section) => ({ ...section, items: section.items.filter((item) => item.grantable) }))
    .filter((section) => section.items.length > 0);
}
