import { ROLES } from '../constants/roles';
import { PAGE_PERMISSION_LABELS } from '../constants/pagePermissions';
import { GRANTABLE_SETTINGS_TAB_IDS } from './settingsAudience';

/**
 * Samenvatting van wat een gebruiker daadwerkelijk mag, voor de Users-tabel.
 *
 * Alleen bij een employee zegt `dbo.user_permissions` iets: een admin mag per definitie alles
 * (zie `requirePagePermission`) en een vendor bereikt geen enkele instellingentab, hoe de tabel
 * ook gevuld is. Puur de permissierijen tonen gaf daardoor "No permissions" bij een admin.
 *
 * @param {string} [role]
 * @param {string[]} [permissions] page_name-waarden uit dbo.user_permissions
 * @returns {{ hasAccess: boolean, statusLabel: string, badges: string[], emptyLabel: string }}
 */
export function getUserAccessSummary(role, permissions = []) {
  if (role === ROLES.ADMIN) {
    return { hasAccess: true, statusLabel: 'Full access', badges: ['All settings'], emptyLabel: '' };
  }

  if (role === ROLES.SUPPLIER) {
    return { hasAccess: true, statusLabel: 'Vendor access', badges: ['Purchase orders'], emptyLabel: '' };
  }

  const granted = Array.isArray(permissions) ? permissions : [];
  // Volgorde van de sidebar aanhouden, niet de volgorde waarin de rijen zijn opgeslagen.
  const badges = GRANTABLE_SETTINGS_TAB_IDS
    .filter((id) => granted.includes(id))
    .map((id) => PAGE_PERMISSION_LABELS[id]);

  if (badges.length === 0) {
    return { hasAccess: false, statusLabel: 'No settings access', badges: [], emptyLabel: 'General only' };
  }

  return { hasAccess: true, statusLabel: 'Enabled', badges, emptyLabel: '' };
}
