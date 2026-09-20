import React, { useState, useEffect, useCallback } from 'react';
import {
  Button,
  Text,
  MessageBar,
  MessageBarBody,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
  makeStyles,
} from '@fluentui/react-components';
import { Shield24Regular } from '@fluentui/react-icons';
import { apiRequest } from '../../utils/api';
import { ROLES } from '../../constants/roles';
import PermissionsChecklist from './PermissionsChecklist';

const useStyles = makeStyles({
  notice: { marginBottom: '8px' },
});

export default function EditPermissionsDialog({ user, open, onOpenChange, onSaved }) {
  const styles = useStyles();
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const loadPermissions = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest(`/admin/users/${user.id}/permissions`);
      setPermissions((Array.isArray(data) ? data : []).map((p) => p.page_name));
    } catch {
      setError('Failed to load permissions');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (open && user?.id) {
      setSuccess(false);
      loadPermissions();
    }
  }, [open, user?.id, loadPermissions]);

  const handlePermissionToggle = useCallback((pageName) => {
    setPermissions((prev) =>
      prev.includes(pageName) ? prev.filter((p) => p !== pageName) : [...prev, pageName]
    );
  }, []);

  const handleSave = useCallback(async () => {
    if (!user?.id) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await apiRequest(`/admin/users/${user.id}/permissions`, {
        method: 'PATCH',
        body: { permissions: permissions.map((page_name) => ({ page_name })) },
      });
      setSuccess(true);
      onSaved();
      setTimeout(() => onOpenChange(false), 1200);
    } catch (err) {
      setError(err.message || 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  }, [user?.id, permissions, onSaved, onOpenChange]);

  const handleOpenChange = useCallback((_, data) => {
    onOpenChange(data.open);
  }, [onOpenChange]);

  if (!user) return null;

  // Instellingen-permissies gelden alleen voor employees; admins mogen al alles en vendors
  // bereiken geen enkele instellingentab (#AB:326).
  const isEmployee = user.role === ROLES.EMPLOYEE;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Permissions for {user.email}</DialogTitle>
          <DialogContent>
            {error && (
              <MessageBar intent="error" className={styles.notice}>
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
            {success && (
              <MessageBar intent="success" className={styles.notice}>
                <MessageBarBody>Permissions saved</MessageBarBody>
              </MessageBar>
            )}
            {!isEmployee && (
              <Text>Settings permissions can only be granted to employees.</Text>
            )}
            {isEmployee && loading && <Text>Loading...</Text>}
            {isEmployee && !loading && (
              <PermissionsChecklist selected={permissions} onToggle={handlePermissionToggle} />
            )}
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary">{isEmployee ? 'Cancel' : 'Close'}</Button>
            </DialogTrigger>
            {isEmployee && (
              <Button
                appearance="primary"
                icon={<Shield24Regular />}
                onClick={handleSave}
                disabled={saving || loading}
              >
                {saving ? 'Saving...' : 'Save'}
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
