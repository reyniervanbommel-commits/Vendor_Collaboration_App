import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiRequest } from '../utils/api';
import { PAGE_PERMISSION_LABELS } from '../constants/pagePermissions';

/**
 * useUsersManagement — state en handlers voor admin gebruikersbeheer.
 */
export function useUsersManagement() {
  const [users, setUsers] = useState([]);
  const [userPermissions, setUserPermissions] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [permDialogUser, setPermDialogUser] = useState(null);
  const [permDialogOpen, setPermDialogOpen] = useState(false);
  const [deleteDialogUser, setDeleteDialogUser] = useState(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [vendorDialogUser, setVendorDialogUser] = useState(null);
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const [roleDialogUser, setRoleDialogUser] = useState(null);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [recentlyUpdatedUserId, setRecentlyUpdatedUserId] = useState(null);
  const [resetMessage, setResetMessage] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest('/admin/users?pageSize=500');
      const list = data.users || [];
      setUsers(list);

      const permissionsMap = {};
      await Promise.all(list.map(async (user) => {
        try {
          const perms = await apiRequest(`/admin/users/${user.id}/permissions`);
          permissionsMap[user.id] = (Array.isArray(perms) ? perms : []).map((p) => p.page_name);
        } catch {
          permissionsMap[user.id] = [];
        }
      }));
      setUserPermissions(permissionsMap);
    } catch (err) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    if (!searchTerm.trim()) return users;
    const term = searchTerm.toLowerCase();
    return users.filter((u) =>
      u.email.toLowerCase().includes(term) ||
      (u.role || '').toLowerCase().includes(term)
    );
  }, [users, searchTerm]);

  const handleLockToggle = useCallback(async (userId, isLocked) => {
    try {
      await apiRequest(`/admin/users/${userId}`, { method: 'PATCH', body: { is_locked: !isLocked } });
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Failed to update user');
    }
  }, [loadUsers]);

  const handleMfaRequiredToggle = useCallback(async (userId, isRequired) => {
    try {
      await apiRequest(`/admin/users/${userId}`, { method: 'PATCH', body: { mfa_required: !isRequired } });
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Failed to update MFA setting');
    }
  }, [loadUsers]);

  const handleForceReset = useCallback(async (userId) => {
    try {
      await apiRequest(`/admin/users/${userId}/force-reset`, { method: 'POST', body: {} });
      setResetMessage('Password reset email has been sent.');
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Failed to send reset');
    }
  }, [loadUsers]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteDialogUser) return;
    try {
      await apiRequest(`/admin/users/${deleteDialogUser.id}`, { method: 'DELETE' });
      setDeleteDialogOpen(false);
      setDeleteDialogUser(null);
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Failed to delete user');
      setDeleteDialogOpen(false);
    }
  }, [deleteDialogUser, loadUsers]);

  const handleDeleteClick = useCallback((user) => {
    setDeleteDialogUser(user);
    setDeleteDialogOpen(true);
  }, []);

  const handleEditPermissions = useCallback((user) => {
    setPermDialogUser(user);
    setPermDialogOpen(true);
  }, []);

  const handleEditVendorAccount = useCallback((user) => {
    setVendorDialogUser(user);
    setVendorDialogOpen(true);
  }, []);

  const handleVendorAccountSave = useCallback(async (userId, vendorAccount) => {
    await apiRequest(`/admin/users/${userId}`, { method: 'PATCH', body: { vendor_account: vendorAccount } });
    await loadUsers();
    setRecentlyUpdatedUserId(userId);
    setTimeout(() => setRecentlyUpdatedUserId(null), 2000);
  }, [loadUsers]);

  const handleEditRole = useCallback((user) => {
    setRoleDialogUser(user);
    setRoleDialogOpen(true);
  }, []);

  const handleRoleSave = useCallback(async (userId, role) => {
    await apiRequest(`/admin/users/${userId}`, { method: 'PATCH', body: { role } });
    await loadUsers();
    setRecentlyUpdatedUserId(userId);
    setTimeout(() => setRecentlyUpdatedUserId(null), 2000);
  }, [loadUsers]);

  const handlePermissionsSaved = useCallback(() => {
    const userId = permDialogUser?.id;
    loadUsers();
    if (userId) {
      setRecentlyUpdatedUserId(userId);
      setTimeout(() => setRecentlyUpdatedUserId(null), 2000);
    }
  }, [permDialogUser?.id, loadUsers]);

  const getDisplayPermissions = useCallback((rawPermissions) => {
    const unique = new Set();
    rawPermissions.forEach((perm) => {
      const label = PAGE_PERMISSION_LABELS[perm];
      if (label) unique.add(label);
    });
    return Array.from(unique);
  }, []);

  return {
    filteredUsers,
    userPermissions,
    loading,
    error,
    searchTerm,
    setSearchTerm,
    createDialogOpen,
    setCreateDialogOpen,
    permDialogUser,
    permDialogOpen,
    setPermDialogOpen,
    deleteDialogUser,
    deleteDialogOpen,
    setDeleteDialogOpen,
    vendorDialogUser,
    vendorDialogOpen,
    setVendorDialogOpen,
    roleDialogUser,
    roleDialogOpen,
    setRoleDialogOpen,
    recentlyUpdatedUserId,
    resetMessage,
    setResetMessage,
    loadUsers,
    handleLockToggle,
    handleMfaRequiredToggle,
    handleForceReset,
    handleDeleteClick,
    handleDeleteConfirm,
    handleEditPermissions,
    handleEditVendorAccount,
    handleVendorAccountSave,
    handleEditRole,
    handleRoleSave,
    handlePermissionsSaved,
    getDisplayPermissions,
  };
}
