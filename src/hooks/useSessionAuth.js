import { useCallback, useEffect, useMemo, useState } from 'react';
import { clearCachedBoard } from '../utils/boardSessionStore';
import { clearBoardPresentationCache } from '../utils/boardPresentationCache';
import { clearAllPoTableSessions } from '../utils/poTableSessionState';
import { PO_TABLE_ZOOM_DEFAULT, setPoTableZoom } from '../utils/poTableZoom';

// Leegt alle in-memory board-caches (data + presentatie). Nodig bij een sessiewissel zodat
// bijv. een supplier niet kortstondig het (ongescopete) bord/totaal van een vorige gebruiker
// ziet — de caches zijn niet per gebruiker gescheiden.
function clearBoardCaches() {
  clearCachedBoard();
  clearBoardPresentationCache();
  clearAllPoTableSessions();
}

async function apiRequest(path, options) {
  const opts = options || {};
  const res = await fetch('/api/auth' + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function applySessionPoTableZoom(data) {
  if (data && data.poTableZoom != null) setPoTableZoom(data.poTableZoom);
}

// Granulaire instellingen-permissies van de ingelogde gebruiker (#AB:326); de backend stuurt ze
// vers mee bij /me, /login en /set-password, zodat ze nooit stale zijn.
function readPermissions(data) {
  return Array.isArray(data?.permissions) ? data.permissions : [];
}

export function useSessionAuth() {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const checkAuth = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest('/me');
      setUser(data.user);
      setPermissions(readPermissions(data));
      if (data.user) applySessionPoTableZoom(data);
      else setPoTableZoom(PO_TABLE_ZOOM_DEFAULT);
      setError(null);
      return data;
    } catch (_) {
      setUser(null);
      setPermissions([]);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const login = useCallback(async (email, password) => {
    // Wis eventuele board-caches van een vorige sessie vóór de nieuwe gebruiker landt.
    clearBoardCaches();
    const data = await apiRequest('/login', { method: 'POST', body: { email, password } });
    if (data.user) setUser(data.user);
    setPermissions(readPermissions(data));
    applySessionPoTableZoom(data);
    return data;
  }, []);

  const setPassword = useCallback(async (email, password) => {
    const data = await apiRequest('/set-password', { method: 'POST', body: { email, password } });
    if (data.user) setUser(data.user);
    setPermissions(readPermissions(data));
    applySessionPoTableZoom(data);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try { await apiRequest('/logout', { method: 'POST', body: {} }); } finally {
      clearBoardCaches();
      setPoTableZoom(PO_TABLE_ZOOM_DEFAULT);
      setUser(null);
      setPermissions([]);
    }
  }, []);

  const actions = useMemo(() => ({ login, logout, checkAuth, setPassword }), [login, logout, checkAuth, setPassword]);

  return useMemo(() => ({
    user, permissions, loading, error,
    isAuthenticated: Boolean(user),
    actions,
  }), [user, permissions, loading, error, actions]);
}
