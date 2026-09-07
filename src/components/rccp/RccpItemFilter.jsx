import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Combobox, Field, Option, makeStyles, tokens } from '@fluentui/react-components';
import {
  ALL_ITEMS_LABEL,
  filterRccpItemPickerItems,
  rccpItemPickerDisplayValue,
} from './rccpItemPicker';

const useStyles = makeStyles({
  field: { maxWidth: '280px', minWidth: '180px' },
  listbox: {
    minWidth: '280px',
    maxWidth: '720px',
  },
  listboxWide: {
    minWidth: '560px',
    maxWidth: '860px',
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    display: 'grid',
    columnGap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  row: {
    display: 'grid',
    columnGap: tokens.spacingHorizontalM,
    alignItems: 'center',
    minWidth: 0,
  },
  cell: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

const LISTBOX_POSITIONING = { matchTargetSize: false };

// Fixed pixel widths (not fr/minmax) so every row's independent grid computes
// identical column widths — using fr per row caused column drift because
// each Option renders its own grid container sized by that row's own content.
const ITEM_COLUMN_WIDTH = 160;
const EXTRA_COLUMN_WIDTH = 130;

function gridTemplate(extraCount) {
  if (extraCount <= 0) return `${ITEM_COLUMN_WIDTH}px`;
  return `${ITEM_COLUMN_WIDTH}px repeat(${extraCount}, ${EXTRA_COLUMN_WIDTH}px)`;
}

function cellText(value) {
  if (value === null || value === undefined) return '—';
  const trimmed = String(value).trim();
  return trimmed === '' ? '—' : trimmed;
}

/**
 * Searchable unique-item filter for the RCCP capacity vs load chart.
 */
export default function RccpItemFilter({
  value = [],
  onChange,
  items = [],
  extraColumns = [],
  extraValues = {},
}) {
  const styles = useStyles();
  const inputRef = useRef(null);
  const selectedItems = Array.isArray(value) ? value : (value ? [value] : []);
  const selectedLabel = rccpItemPickerDisplayValue(selectedItems);
  const [query, setQuery] = useState(selectedLabel);
  const hasExtra = extraColumns.length > 0;
  const template = gridTemplate(extraColumns.length);

  const listboxSlot = useMemo(() => ({
    className: hasExtra ? styles.listboxWide : styles.listbox,
  }), [hasExtra, styles.listbox, styles.listboxWide]);

  useEffect(() => {
    setQuery(selectedLabel);
  }, [selectedLabel]);

  const isSearching = query.trim() !== '' && query !== selectedLabel;

  const filteredItems = useMemo(() => {
    if (!isSearching) return items;
    return filterRccpItemPickerItems(items, extraValues, extraColumns, query);
  }, [items, extraValues, extraColumns, query, isSearching]);

  const showAllOption = !isSearching
    || ALL_ITEMS_LABEL.toLowerCase().includes(query.trim().toLowerCase());

  const handleOptionSelect = useCallback((_, data) => {
    if (data.optionValue === undefined) return;
    if (data.optionValue === '') {
      onChange([]);
      setQuery(ALL_ITEMS_LABEL);
      return;
    }
    const next = (data.selectedOptions || []).filter(Boolean);
    onChange(next);
    setQuery(rccpItemPickerDisplayValue(next));
  }, [onChange]);

  const handleInputChange = useCallback((event) => {
    setQuery(event.target.value);
  }, []);

  const handleBlur = useCallback(() => {
    setQuery(selectedLabel);
  }, [selectedLabel]);

  const handleInputFocus = useCallback((event) => {
    event.target.select();
  }, []);

  const handleOpenChange = useCallback((_, data) => {
    if (!data.open) return;
    requestAnimationFrame(() => {
      inputRef.current?.select?.();
    });
  }, []);

  const inputSlot = useMemo(() => ({
    ref: inputRef,
    onFocus: handleInputFocus,
  }), [handleInputFocus]);

  const hasItems = items.length > 0;

  return (
    <Field
      className={styles.field}
      label="Item"
      hint={hasItems ? undefined : 'No unique items in the selected weeks'}
    >
      <Combobox
        freeform
        multiselect
        disabled={!hasItems}
        value={query}
        selectedOptions={selectedItems}
        placeholder={hasItems ? 'Search items...' : 'No items in this week range'}
        input={inputSlot}
        listbox={listboxSlot}
        positioning={LISTBOX_POSITIONING}
        onOptionSelect={handleOptionSelect}
        onOpenChange={handleOpenChange}
        onChange={handleInputChange}
        onBlur={handleBlur}
      >
        {hasExtra && (
          <div className={styles.header} style={{ gridTemplateColumns: template }} role="presentation">
            <span className={styles.cell}>Item number</span>
            {extraColumns.map((column) => (
              <span key={column.key} className={styles.cell}>{column.label || column.key}</span>
            ))}
          </div>
        )}
        {showAllOption && (
          <Option value="" text={ALL_ITEMS_LABEL}>{ALL_ITEMS_LABEL}</Option>
        )}
        {filteredItems.map((item) => {
          const rowValues = extraValues[item] || {};
          return (
            <Option key={item} value={item} text={item}>
              {hasExtra ? (
                <div className={styles.row} style={{ gridTemplateColumns: template }}>
                  <span className={styles.cell}>{cellText(item)}</span>
                  {extraColumns.map((column) => (
                    <span key={column.key} className={styles.cell}>{cellText(rowValues[column.key])}</span>
                  ))}
                </div>
              ) : item}
            </Option>
          );
        })}
      </Combobox>
    </Field>
  );
}
