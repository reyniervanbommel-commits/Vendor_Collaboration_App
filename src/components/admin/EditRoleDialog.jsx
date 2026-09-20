import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
  Button,
  Select,
  Field,
  MessageBar,
  MessageBarBody,
  makeStyles,
} from '@fluentui/react-components';
import { ROLES } from '../../constants/roles';

const useStyles = makeStyles({
  notice: { marginBottom: '16px' },
});

const ROLE_OPTIONS = [
  { value: ROLES.ADMIN, label: 'Admin — full access to every setting' },
  { value: ROLES.EMPLOYEE, label: 'Employee — access per granted settings permission' },
  { value: ROLES.SUPPLIER, label: 'Vendor — only the purchase orders of their own vendor account' },
];

/**
 * Dialog om de rol van een bestaande gebruiker te wijzigen. Een rol naar of van employee
 * bepaalt of granulaire instellingen-permissies nog gelden, dus die waarschuwing hoort hier.
 */
export default function EditRoleDialog({ user, open, onOpenChange, onSave }) {
  const styles = useStyles();
  const [role, setRole] = useState(ROLES.SUPPLIER);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setRole(user?.role || ROLES.SUPPLIER);
      setError(null);
    }
  }, [open, user]);

  const handleOpenChange = useCallback((_, data) => {
    onOpenChange(data.open);
  }, [onOpenChange]);

  const handleRoleChange = useCallback((event) => {
    setRole(event.target.value);
  }, []);

  const handleCancel = useCallback(() => onOpenChange(false), [onOpenChange]);

  const handleSubmit = useCallback(async () => {
    if (!user) return;
    setError(null);
    setLoading(true);
    try {
      await onSave(user.id, role);
      onOpenChange(false);
    } catch (err) {
      setError(err.message || 'Failed to change role');
    } finally {
      setLoading(false);
    }
  }, [user, role, onSave, onOpenChange]);

  const losesPermissions = user?.role === ROLES.EMPLOYEE && role !== ROLES.EMPLOYEE;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogSurface>
        <DialogTitle>Change role</DialogTitle>
        <DialogBody>
          {error && (
            <MessageBar intent="error" className={styles.notice}>
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          )}
          {losesPermissions && (
            <MessageBar intent="warning" className={styles.notice}>
              <MessageBarBody>
                The granted settings permissions of this user will be cleared.
              </MessageBarBody>
            </MessageBar>
          )}
          <DialogContent>
            <Field
              label={`Role for ${user?.email || ''}`}
              hint="Admins can always reach every setting. You cannot change your own role."
            >
              <Select value={role} onChange={handleRoleChange} disabled={loading}>
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </Field>
          </DialogContent>
        </DialogBody>
        <DialogActions>
          <Button appearance="secondary" disabled={loading} onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            appearance="primary"
            onClick={handleSubmit}
            disabled={loading || role === user?.role}
          >
            {loading ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </DialogSurface>
    </Dialog>
  );
}
