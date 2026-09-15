import { ROLES } from '../../constants/roles';

export const STAFF = [ROLES.ADMIN, ROLES.EMPLOYEE];

/** Selector for a [data-tour] anchor. */
export const t = (name) => `[data-tour="${name}"]`;

export const COLUMN_MENU_SURFACE = '[data-column-menu-surface="true"]';
export const COLUMN_MENU_MISSING = 'No column menu is visible right now. Open the Master plan board and make sure orders are loaded.';
