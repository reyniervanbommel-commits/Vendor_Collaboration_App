import React, { memo, useCallback, useMemo, useState } from 'react';
import { Button, Field, Input, Select, Text, makeStyles, shorthands, tokens } from '@fluentui/react-components';
import { ChevronDownRegular, ChevronRightRegular } from '@fluentui/react-icons';
import { rccpFieldLabel, RccpInfoLabel } from './rccpFieldLabel';
import RccpItemPickerColumnsEditor from './RccpItemPickerColumnsEditor';
import RccpNarrowDropdown from './RccpNarrowDropdown';
import { buildRccpColumnOption, matchRccpColumn, rccpColumnOptionValue } from '../../utils/rccpColumnGroups';
import { isRccpDateColumn, isRccpVendorColumn } from '../../utils/rccpQuantityColumns';

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalL),
    width: '100%',
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalM),
  },
  groupTitle: { color: tokens.colorNeutralForeground2 },
  slot: { width: '200px', maxWidth: '200px' },
  toggle: { alignSelf: 'flex-start' },
});

const EMPTY_COLUMN = '__none__';

function ColumnSelect({
  label, value, onChange, columns, info, compact, allowEmpty = false,
}) {
  const styles = useStyles();
  const options = useMemo(() => {
    const mapped = columns.map(buildRccpColumnOption);
    return allowEmpty
      ? [{ value: EMPTY_COLUMN, text: 'None', shortText: 'None' }, ...mapped]
      : mapped;
  }, [allowEmpty, columns]);
  const matched = matchRccpColumn(columns, value);
  const resolvedValue = value
    ? (matched ? rccpColumnOptionValue(matched) : value)
    : (allowEmpty ? EMPTY_COLUMN : value);
  const selected = options.find((opt) => opt.value === resolvedValue);
  const handleSelect = useCallback((key) => {
    onChange({ target: { value: key === EMPTY_COLUMN ? '' : key } });
  }, [onChange]);

  return (
    <div className={styles.slot}>
      <Field label={rccpFieldLabel(label, info)}>
        <RccpNarrowDropdown
          size={compact ? 'small' : 'medium'}
          selectedValue={resolvedValue}
          selectedText={selected?.shortText || value}
          options={options}
          onSelect={handleSelect}
        />
      </Field>
    </div>
  );
}

function CapacityImportFields({ compact, policy, onPolicy }) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const toggleOpen = useCallback(() => setOpen((current) => !current), []);

  return (
    <div className={styles.group}>
      <Button
        className={styles.toggle}
        size="small"
        appearance="subtle"
        icon={open ? <ChevronDownRegular /> : <ChevronRightRegular />}
        aria-expanded={open}
        onClick={toggleOpen}
      >
        Capacity import
      </Button>
      {open && (
        <div className={styles.slot}>
          <Field
            label={rccpFieldLabel(
              'Duplicate Excel rows',
              'What to do when an imported week already exists.',
            )}
          >
            <Select
              size={compact ? 'small' : 'medium'}
              value={policy || 'update'}
              onChange={onPolicy}
            >
              <option value="update">Update existing rows</option>
              <option value="skip">Skip duplicates</option>
            </Select>
          </Field>
        </div>
      )}
    </div>
  );
}

function RccpSettingsDataFields({
  config, columns, itemColumns = [], statusOptions, compact, onUpdateField, onItemPickerColumns,
}) {
  const styles = useStyles();
  const vendorColumns = useMemo(() => columns.filter(isRccpVendorColumn), [columns]);
  const dateColumns = useMemo(() => columns.filter(isRccpDateColumn), [columns]);
  const known = statusOptions.length
    ? `Comma-separated labels to ignore in the matrix. Known statuses: ${statusOptions.join(', ')}.`
    : 'Comma-separated status labels to ignore in the matrix.';

  const handleVendor = useCallback((e) => {
    onUpdateField('vendorColumnKey', e.target.value);
  }, [onUpdateField]);
  const handleDate = useCallback((e) => {
    onUpdateField('dateColumnKey', e.target.value);
  }, [onUpdateField]);
  const handleConfirmed = useCallback((e) => {
    onUpdateField('confirmedDateColumnKey', e.target.value);
  }, [onUpdateField]);
  const handleReceipt = useCallback((e) => {
    onUpdateField('receiptDateColumnKey', e.target.value);
  }, [onUpdateField]);
  const handleStatuses = useCallback((e) => {
    onUpdateField(
      'excludedStatuses',
      e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
    );
  }, [onUpdateField]);
  const handlePolicy = useCallback((e) => {
    onUpdateField('duplicatePolicy', e.target.value);
  }, [onUpdateField]);

  return (
    <div className={styles.stack}>
      <div className={styles.group}>
        <Text weight="semibold" className={styles.groupTitle}>Purchase order fields</Text>
        <ColumnSelect
          compact={compact}
          label="Vendor"
          info="Purchase order column that identifies the vendor."
          value={config.vendorColumnKey}
          onChange={handleVendor}
          columns={vendorColumns}
        />
        <ColumnSelect
          compact={compact}
          label="Requested delivery date"
          info="PO header or PO line date for this slot. Used when confirmed date is empty."
          value={config.dateColumnKey}
          onChange={handleDate}
          columns={dateColumns}
        />
        <ColumnSelect
          compact={compact}
          label="Confirmed delivery date"
          info="PO header or PO line date. When filled, this week is used for open and ordered load. Empty or 1-1-1900 falls back to requested."
          value={config.confirmedDateColumnKey || ''}
          onChange={handleConfirmed}
          columns={dateColumns}
          allowEmpty
        />
        <ColumnSelect
          compact={compact}
          label="Receipt date"
          info="PO header or PO line date used to place received quantity below the axis. If empty, the delivery date is used."
          value={config.receiptDateColumnKey || ''}
          onChange={handleReceipt}
          columns={dateColumns}
          allowEmpty
        />
      </div>
      <div className={styles.group}>
        <Text weight="semibold" className={styles.groupTitle}>Load filter</Text>
        <div className={styles.slot}>
          <Field label={rccpFieldLabel('Excluded PO statuses', known)}>
            <Input
              size={compact ? 'small' : 'medium'}
              value={(config.excludedStatuses || []).join(', ')}
              onChange={handleStatuses}
            />
          </Field>
        </div>
      </div>
      <div className={styles.group}>
        <Text weight="semibold" className={styles.groupTitle}>
          <RccpInfoLabel info="Extra item-entity fields shown after the unique item number in the Item dropdown.">
            Item picker
          </RccpInfoLabel>
        </Text>
        <RccpItemPickerColumnsEditor
          columns={itemColumns}
          selectedKeys={config.itemPickerColumnKeys || []}
          compact={compact}
          onChange={onItemPickerColumns}
        />
      </div>
      <CapacityImportFields
        compact={compact}
        policy={config.duplicatePolicy}
        onPolicy={handlePolicy}
      />
    </div>
  );
}

export default memo(RccpSettingsDataFields);
