import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
  Button,
  Input,
  Field,
  Select,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';
import { PersonAdd24Regular } from '@fluentui/react-icons';
import { apiRequest } from '../../utils/api';
import { ROLES } from '../../constants/roles';

/**
 * Nieuw account aanmaken. Zonder `allowStaffRoles` blijft alleen de vendor-rol over: een employee
 * met de 'users'-permissie mag uitsluitend vendors aanmaken, de backend weigert de rest met 403.
 */
export default function CreateUserDialog({ open, onOpenChange, onUserCreated, allowStaffRoles }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(ROLES.SUPPLIER);
  const [vendorAccount, setVendorAccount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isSupplier = role === ROLES.SUPPLIER;

  const handleSubmit = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const body = { email, role };
      if (isSupplier && vendorAccount.trim()) body.vendor_account = vendorAccount.trim();
      await apiRequest('/admin/users', { method: 'POST', body });
      setEmail('');
      setRole(ROLES.SUPPLIER);
      setVendorAccount('');
      onOpenChange(false);
      if (onUserCreated) onUserCreated();
    } catch (err) {
      setError(err.message || 'Failed to create user');
    } finally {
      setLoading(false);
    }
  }, [email, role, isSupplier, vendorAccount, onOpenChange, onUserCreated]);

  const handleOpenChange = useCallback((_, data) => {
    onOpenChange(data.open);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger disableButtonEnhancement>
        <Button appearance="primary" icon={<PersonAdd24Regular />}>
          Create user
        </Button>
      </DialogTrigger>
      <DialogSurface>
        <DialogTitle>New user</DialogTitle>
        <DialogBody>
          {error && (
            <MessageBar intent="error" style={{ marginBottom: '16px' }}>
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          )}
          <DialogContent>
            <Field label="Email address" required>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="naam@voorbeeld.nl"
                disabled={loading}
              />
            </Field>
            <Field label="Role">
              <Select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={loading || !allowStaffRoles}
              >
                <option value={ROLES.SUPPLIER}>Supplier</option>
                {allowStaffRoles && <option value={ROLES.EMPLOYEE}>Employee</option>}
                {allowStaffRoles && <option value={ROLES.ADMIN}>Admin</option>}
              </Select>
            </Field>
            {isSupplier && (
              <Field label="Vendor account" hint="Only orders with this D365 vendor account are visible. Leave empty to use the email prefix.">
                <Input
                  value={vendorAccount}
                  onChange={(e) => setVendorAccount(e.target.value)}
                  placeholder="e.g. 1001"
                  disabled={loading}
                />
              </Field>
            )}
          </DialogContent>
        </DialogBody>
        <DialogActions>
          <DialogTrigger disableButtonEnhancement>
            <Button appearance="secondary" disabled={loading}>Cancel</Button>
          </DialogTrigger>
          <Button appearance="primary" onClick={handleSubmit} disabled={loading || !email}>
            {loading ? 'Working...' : 'Create'}
          </Button>
        </DialogActions>
      </DialogSurface>
    </Dialog>
  );
}
