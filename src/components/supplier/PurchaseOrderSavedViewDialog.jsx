import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Radio,
  RadioGroup,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import { VIEW_NAME_MAX_LENGTH } from '../../utils/savedViewDisplay';

const useStyles = makeStyles({
  form: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('16px'),
  },
  vendorField: {
    maxWidth: '168px',
  },
});

// Dialog voor "opslaan als nieuwe view" en "hernoemen". mode bepaalt de velden.
export default function PurchaseOrderSavedViewDialog({
  open,
  mode,
  canManageGlobal,
  initialName,
  onOpenChange,
  onSubmit,
}) {
  const styles = useStyles();
  const [name, setName] = useState('');
  const [scope, setScope] = useState('personal');
  const [vendorAccount, setVendorAccount] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName(initialName || '');
      setScope('personal');
      setVendorAccount('');
      setIsDefault(false);
      setSaving(false);
      setError('');
    }
  }, [open, initialName]);

  const handleSubmit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a name.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit({ name: trimmed, scope, isDefault, vendorAccount: scope === 'vendor' ? vendorAccount.trim() : '' });
      onOpenChange(false);
    } catch (err) {
      setError(err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }, [name, scope, isDefault, vendorAccount, onSubmit, onOpenChange]);

  const title = mode === 'rename' ? 'Rename view' : 'Save as new view';

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>
            <div className={styles.form}>
              <Field label="Name" required hint={`Max. ${VIEW_NAME_MAX_LENGTH} characters`}>
                <Input
                  value={name}
                  maxLength={VIEW_NAME_MAX_LENGTH}
                  onChange={(_, data) => setName(data.value.slice(0, VIEW_NAME_MAX_LENGTH))}
                  placeholder="e.g. Open this week"
                />
              </Field>

              {mode === 'create' && canManageGlobal ? (
                <Field label="Visibility">
                  <RadioGroup
                    layout="vertical"
                    value={scope}
                    onChange={(_, data) => setScope(data.value)}
                  >
                    <Radio value="personal" label="Personal" />
                    <Radio value="vendor" label="Vendor view" />
                    <Radio value="global" label="Shared (staff only)" />
                  </RadioGroup>
                </Field>
              ) : null}

              {mode === 'create' && canManageGlobal && scope === 'vendor' ? (
                <Field
                  className={styles.vendorField}
                  label="Vendor account"
                  hint="Leave empty for all vendors. Fill in a D365 vendor account to assign this view to one supplier."
                >
                  <Input
                    value={vendorAccount}
                    onChange={(_, data) => setVendorAccount(data.value)}
                    placeholder="e.g. Q000104"
                  />
                </Field>
              ) : null}

              {mode === 'create' ? (
                <Checkbox
                  checked={isDefault}
                  onChange={(_, data) => setIsDefault(Boolean(data.checked))}
                  label="Set as default view"
                />
              ) : null}

              {error ? <Field validationState="error" validationMessage={error} /> : null}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button appearance="primary" onClick={handleSubmit} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
