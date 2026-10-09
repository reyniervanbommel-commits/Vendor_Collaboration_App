import { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../utils/api';
import { STAFF_ROLES } from '../constants/roles';

const ANALYTICS_ROLES = new Set(STAFF_ROLES);

function getOrCreateSessionId() {
  const storageKey = 'analytics.session.id';
  const existingId = window.sessionStorage.getItem(storageKey);
  if (existingId) return existingId;
  const generatedId = `sid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem(storageKey, generatedId);
  return generatedId;
}

/**
 * Registreert routewissels voor analytics op admin/employee accounts.
 */
export function useRouteAnalytics() {
  const location = useLocation();
  const { isAuthenticated, user } = useAuth();
  const previousPathRef = useRef('');
  const sessionId = useMemo(getOrCreateSessionId, []);
  const userRole = user?.role || '';

  useEffect(() => {
    if (!isAuthenticated || !ANALYTICS_ROLES.has(userRole)) return;
    const currentPath = location.pathname || '/';
    if (previousPathRef.current === currentPath) return;
    previousPathRef.current = currentPath;

    apiRequest('/admin/analytics/log-route', {
      method: 'POST',
      body: {
        page_name: currentPath,
        session_id: sessionId,
      },
    }).catch(() => {});
  }, [isAuthenticated, userRole, location.pathname, sessionId]);
}
