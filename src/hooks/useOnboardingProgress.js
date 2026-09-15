import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../utils/api';

/**
 * Loads guide/tour progress of all users for the staff analytics page.
 * @returns {{ users: Array, loading: boolean, error: string|null, refresh: () => void }}
 */
export function useOnboardingProgress() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest('/admin/analytics/onboarding');
      setUsers(Array.isArray(data?.users) ? data.users : []);
    } catch (err) {
      setError(err?.message || 'Failed to load guide progress');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { users, loading, error, refresh };
}
