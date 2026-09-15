import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  Option,
  Text,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { resolveDatePeriodSourceKey } from '../../utils/datePeriodColumnUtils';

const useStyles = makeStyles({
  form: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('14px'),
  },
  helperText: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

export default function PurchaseOrderDatePeriodColumnDialog({
  open,
  onOpenChange,
  onSubmit,
  sourceColumn,
  dateSourceColumns = [],
  initialValue = null,
}) {
  const styles = useStyles();
  const [label, setLabel] = useState('Date W/M');
  const [sourceColumnKey, setSourceColumnKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const sourceOptions = useMemo(
    () => dateSourceColumns.map((column) => ({
      key: column.key,
      label: String(column.label || column.key || '').trim(),
    })),
    [dateSourceColumns]
  );

  useEffect(() => {
    if (!open) return;
    setLabel(String(initialValue?.label || '').trim() || 'Date W/M');
    const preferredSource = resolveDatePeriodSourceKey(initialValue)
      || (sourceOptions.some((entry) => entry.key === sourceColumn?.key) ? sourceColumn.key : '')
      || sourceOptions[0]?.key
      || '';
    setSourceColumnKey(preferredSource);
    setError('');
    setSaving(false);
  }, [initialValue, open, sourceColumn, sourceOptions]);

  const handleSubmit = useCallback(async () => {
    const cleanLabel = String(label || '').trim();
    const cleanSourceKey = String(sourceColumnKey || '').trim();
    if (!cleanLabel) {
      setError('Label is required.');
      return;
    }
    if (!cleanSourceKey) {
      setError('Select a source date column.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit({ label: cleanLabel, sourceColumnKey: cleanSourceKey });
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Creating the column failed.');
    } finally {
      setSaving(false);
    }
  }, [label, onOpenChange, onSubmit, sourceColumnKey]);

  const handleSourceSelect = useCallback((_, data) => {
    setSourceColumnKey(String(data.optionValue || ''));
  }, []);

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(Boolean(data.open))}>
      <DialogSurface data-tour="date-period-dialog">
        <DialogBody>
          <DialogTitle>Date W/M column</DialogTitle>
          <DialogContent>
            <div className={styles.form}>
              <Text className={styles.helperText}>
                Shows week numbers or month names derived from an existing date column.
                Switch display mode later from the column menu (saved per view).
              </Text>
              <Field label="Column label" required data-tour="date-period-label">
                <Input value={label} onChange={(_, data) => setLabel(data.value)} />
              </Field>
              <Field label="Source date column" required data-tour="date-period-source">
                <Dropdown
                  placeholder="Select a date column"
                  value={sourceOptions.find((entry) => entry.key === sourceColumnKey)?.label || ''}
                  selectedOptions={sourceColumnKey ? [sourceColumnKey] : []}
                  onOptionSelect={handleSourceSelect}
                  disabled={!sourceOptions.length}
                >
                  {sourceOptions.map((entry) => (
                    <Option key={entry.key} value={entry.key} text={entry.label}>
                      {entry.label}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              {!sourceOptions.length ? (
                <Text className={styles.helperText}>No date columns are available in this table.</Text>
              ) : null}
              {error ? <Text role="alert">{error}</Text> : null}
            </div>
          </DialogContent>
          <DialogActions data-tour="date-period-actions">
            <Button appearance="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button appearance="primary" onClick={handleSubmit} disabled={saving || !sourceOptions.length}>
              Add column
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
