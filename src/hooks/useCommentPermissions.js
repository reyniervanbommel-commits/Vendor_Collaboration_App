import { useContext, useMemo } from 'react';
import { AuthContext } from '../context/AuthContext';

/**
 * Comment-rechten uit de al geladen sessie (#AB:328). Admin heeft ze altijd.
 * Zonder sessie (tests, eerste paint) blijven de drie aan, gelijk aan het oude gedrag.
 * @returns {{ canView: boolean, canWrite: boolean, canSeeColumn: boolean }}
 */
export function useCommentPermissions() {
  const auth = useContext(AuthContext);
  const role = auth?.user?.role;
  const permissions = auth?.permissions;
  return useMemo(() => {
    if (!auth?.user) {
      return { canView: true, canWrite: true, canSeeColumn: true };
    }
    const isAdmin = role === 'admin';
    const granted = new Set(Array.isArray(permissions) ? permissions : []);
    const canView = isAdmin || granted.has('comments.view');
    return {
      canView,
      canWrite: isAdmin || (canView && granted.has('comments.write')),
      canSeeColumn: isAdmin || (canView && granted.has('comments.column')),
    };
  }, [auth?.user, permissions, role]);
}
