import React, { createContext, useContext, useMemo } from 'react';
import { useSessionAuth } from '../hooks/useSessionAuth';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const auth = useSessionAuth();
  const value = useMemo(() => ({
    user: auth.user,
    loading: auth.loading,
    error: auth.error,
    isAuthenticated: auth.isAuthenticated,
    login: auth.actions.login,
    logout: auth.actions.logout,
    checkAuth: auth.actions.checkAuth,
    setPassword: auth.actions.setPassword,
    hasRole: role => auth.user?.role === role,
  }), [auth]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
