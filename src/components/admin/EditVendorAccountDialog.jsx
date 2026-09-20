import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
  Button,
  Input,
  Field,
  MessageBar,
  MessageBarBody,
  makeStyles,
} from '@fluentui/react-components';

const useStyles = makeStyles({
  notice: { marginBottom: '16px' },
});

/**
 * Dialog om het leveranciersaccount van een supplier-gebruiker te zetten.
 * Bepaalt welke D365 purchase orders (op vendorAccount) de gebruiker mag inzien.
 */
export default function EditVendorAccountDialog({ user, open, onOpenChange, onSave }) {
  const styles = useStyles();
  const [vendorAccount, setVendorAccount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setVendorAccount(user?.vendor_account || '');
      setError(null);
    }
  }, [open, user]);

  const handleOpenChange = useCallback((_, data) => {
    onOpenChange(data.open);
  }, [onOpenChange]);

  const handleSubmit = useCallback(async () => {
    if (!user) return;
    setError(null);
    setLoading(true);
    try {
      await onSave(user.id, vendorAccount.trim());
      onOpenChange(false);
    } catch (err) {
      setError(err.message || 'Failed to save vendor account');
    } finally {
      setLoading(false);
    }
  }, [user, vendorAccount, onSave, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogSurface>
        <DialogTitle>Vendor account</DialogTitle>
        <DialogBody>
          {error && (
            <MessageBar intent="error" className={styles.notice}>
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          )}
          <DialogContent>
            <Field
              label={`Vendor account for ${user?.email || ''}`}
              hint="Only purchase orders with this D365 vendor account are visible. Leave empty to fall back to the email prefix."
            >
              <Input
                value={vendorAccount}
                onChange={(e) => setVendorAccount(e.target.value)}
                placeholder="e.g. 1001"
                disabled={loading}
              />
            </Field>
          </DialogContent>
        </DialogBody>
        <DialogActions>
          <Button appearance="secondary" disabled={loading} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button appearance="primary" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </DialogSurface>
    </Dialog>
  );
}
