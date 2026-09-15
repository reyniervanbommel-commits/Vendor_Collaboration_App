import { ROLES } from '../../constants/roles';

export const STAFF = [ROLES.ADMIN, ROLES.EMPLOYEE];

/** Selector for a [data-tour] anchor. */
export const t = (name) => `[data-tour="${name}"]`;
