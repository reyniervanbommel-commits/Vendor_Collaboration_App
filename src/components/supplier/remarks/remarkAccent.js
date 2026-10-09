import { ROLES } from '../../../constants/roles';

/**
 * Color accent of a remark: its visibility, or 'internal' for employees — they only see and
 * post internal remarks but don't get the visibility field from the server.
 */
export function remarkAccent(visibility, role) {
  if (visibility) return visibility;
  return role === ROLES.EMPLOYEE ? 'internal' : null;
}
