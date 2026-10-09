import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Input, Spinner, makeStyles, mergeClasses, shorthands, tokens } from '@fluentui/react-components';
import { ErrorCircleRegular } from '@fluentui/react-icons';
import CellHistoryPopover from './CellHistoryPopover';
import WeekNumberCalendarPopover from './WeekNumberCalendarPopover';
import { getFormattedCellControlStyle, FORMATTED_CELL_TEXT_COLOR } from './columnTextStyleUtils';
import { useWriteBackCellLock } from '../../hooks/useWriteBackCellLock';
import { PO_TABLE_ZOOM_CSS_VAR, PO_TABLE_ZOOM_DEFAULT } from '../../utils/poTableZoom';
import {
  isDateLikeColumn,
  normalizeDateValue,
  toCalendarValue,
  toDisplayDateValue,
  toInputValue,
} from '../../utils/writeBackDateUtils';

const CELL_FONT_SIZE = `calc(${tokens.fontSizeBase200} * var(${PO_TABLE_ZOOM_CSS_VAR}, ${PO_TABLE_ZOOM_DEFAULT}))`;

const useStyles = makeStyles({
  cell: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('4px'),
    minWidth: 0,
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
    position: 'relative',
    ':has([data-cell-history-trigger="true"])': {
      overflow: 'visible',
    },
  },
  input: {
    minWidth: 0,
    width: '100%',
    color: tokens.colorBrandForeground1,
    fontSize: CELL_FONT_SIZE,
    '> input': {
      color: tokens.colorBrandForeground1,
      fontSize: CELL_FONT_SIZE,
    },
  },
  saved: { color: tokens.colorPaletteGreenForeground1, fontSize: tokens.fontSizeBase300, whiteSpace: 'nowrap' },
  errIcon: { color: tokens.colorPaletteRedForeground1 },
  queued: { backgroundColor: tokens.colorNeutralBackground3 },
});

const useFormattedControlStyles = makeStyles({
  formatted: {
    backgroundColor: 'var(--cell-format-bg)',
    '::before': {
      backgroundColor: 'var(--cell-format-bg)',
    },
    ':hover': {
      backgroundColor: 'var(--cell-format-bg)',
    },
    ':hover::before': {
      backgroundColor: 'var(--cell-format-bg)',
    },
    ':focus-within': {
      backgroundColor: 'var(--cell-format-bg)',
    },
    ':focus-within::before': {
      backgroundColor: 'var(--cell-format-bg)',
    },
  },
  formattedText: {
    color: FORMATTED_CELL_TEXT_COLOR,
    '> input': {
      color: FORMATTED_CELL_TEXT_COLOR,
    },
  },
});

/**
 * Inline write-back-cel voor een D365-veld dat admin als terugschrijfbaar markeerde (#134).
 * Bewerken gebeurt direct in de cel (geen popup). Bij blur/Enter wordt de waarde teruggeschreven
 * naar D365; optimistic concurrency en conflicten worden inline getoond. Bij fout keert de oude
 * waarde terug en verschijnt een fout-icoon met de melding als tooltip.
 */
export default function PurchaseOrderWriteBackCell({
  column,
  value,
  onCorrect,
  cellKeys,
  hasHistory = false,
  cellBackgroundColor = '',
  isConditionalFormat = false,
  ariaLabel,
}) {
  const styles = useStyles();
  const formattedStyles = useFormattedControlStyles();
  const formattedControlStyle = cellBackgroundColor
    ? getFormattedCellControlStyle(cellBackgroundColor, { useWhiteText: isConditionalFormat })
    : undefined;
  const formattedControlClassName = mergeClasses(
    styles.input,
    formattedControlStyle ? formattedStyles.formatted : undefined,
    isConditionalFormat ? formattedStyles.formattedText : undefined,
  );
  const formattedControlInlineStyle = formattedControlStyle
    ? {
      ...formattedControlStyle,
      '--cell-format-bg': formattedControlStyle.backgroundColor,
    }
    : undefined;
  const [local, setLocal] = useState(toInputValue(value, column.dataType, isDateLikeColumn(column, value)));
  const [status, setStatus] = useState('idle'); // idle | saving | saved | error
  const [error, setError] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const savedTimer = useRef(null);
  const savingRef = useRef(false);
  const isDate = isDateLikeColumn(column, value);
  const jobLock = useWriteBackCellLock(column.key, cellKeys?.dataAreaId, cellKeys?.orderNumber);
  const locked = jobLock.status === 'queued' || jobLock.status === 'writing' || jobLock.status === 'failed';
  const resolvedAriaLabel = ariaLabel || `${column.label} (write back to D365)`;

  useEffect(() => {
    const nextIsDate = isDateLikeColumn(column, value);
    setLocal(toInputValue(value, column.dataType, nextIsDate));
  }, [value, column.dataType, column.key, column.label]);
  useEffect(() => () => { if (savedTimer.current) window.clearTimeout(savedTimer.current); }, []);

  const onLocalChange = useCallback((_, data) => setLocal(data.value), []);

  const commit = useCallback(async (draftValue = local) => {
    if (locked) return;
    if (savingRef.current || status === 'saving') return;
    const treatAsDate = isDateLikeColumn(column, value) || isDateLikeColumn(column, draftValue);
    const resolvedValue = treatAsDate ? normalizeDateValue(draftValue) : draftValue;
    const currentValue = treatAsDate ? normalizeDateValue(value) : toInputValue(value, column.dataType);
    if (resolvedValue === currentValue) return;
    savingRef.current = true;
    setStatus('saving');
    setError('');
    try {
      const result = await onCorrect({ value: resolvedValue, basedOnValue: value });
      if (result?.cancelled) {
        setLocal(toInputValue(value, column.dataType, isDateLikeColumn(column, value)));
        setStatus('idle');
        return;
      }
      setLocal(toInputValue(resolvedValue, column.dataType, treatAsDate));
      if (result?.background) {
        setStatus('idle');
        return;
      }
      setStatus('saved');
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setStatus('idle'), 1500);
    } catch (err) {
      setStatus('error');
      setError(err.message || 'Write-back failed');
      const fallback = err.remainingDisplayValue !== undefined && err.remainingDisplayValue !== null
        ? err.remainingDisplayValue
        : value;
      setLocal(toInputValue(fallback, column.dataType, treatAsDate));
    } finally {
      savingRef.current = false;
    }
  }, [local, value, column, onCorrect, locked, status]);

  const commitLocal = useCallback(() => commit(local), [commit, local]);

  const openDatePicker = useCallback(() => {
    setCalendarOpen(true);
  }, []);

  const onCalendarSelect = useCallback((nextValue) => {
    setLocal(toDisplayDateValue(nextValue));
    commit(nextValue);
  }, [commit]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      setLocal(toInputValue(value, column.dataType, isDateLikeColumn(column, value)));
      e.currentTarget.blur();
    }
  }, [value, column]);

  const showSpinner = status === 'saving' || jobLock.status === 'writing';
  const showSaved = status === 'saved' && !jobLock.status;
  const errorMessage = jobLock.status === 'failed' ? (jobLock.errorMessage || error) : error;
  const statusAfter = showSpinner
    ? <Spinner size="extra-tiny" aria-label="Write back" />
    : showSaved
      ? <span className={styles.saved}>✓</span>
      : (status === 'error' || jobLock.status === 'failed')
        ? <ErrorCircleRegular className={styles.errIcon} title={errorMessage || undefined} />
        : undefined;

  const inputControl = isDate ? (
    <WeekNumberCalendarPopover
      open={calendarOpen}
      onOpenChange={setCalendarOpen}
      value={toCalendarValue(local)}
      onSelect={onCalendarSelect}
    >
      <Input
        className={formattedControlClassName}
        style={formattedControlInlineStyle}
        appearance="filled-lighter"
        size="small"
        type="text"
        inputMode="numeric"
        value={local}
        disabled={locked}
        contentAfter={statusAfter}
        aria-label={resolvedAriaLabel}
        onChange={onLocalChange}
        onBlur={commitLocal}
        onKeyDown={onKeyDown}
        onDoubleClick={openDatePicker}
      />
    </WeekNumberCalendarPopover>
  ) : (
    <Input
      className={formattedControlClassName}
      style={formattedControlInlineStyle}
      appearance="filled-lighter"
      size="small"
      type={column.dataType === 'number' ? 'number' : 'text'}
      value={local}
      disabled={locked}
      contentAfter={statusAfter}
      aria-label={resolvedAriaLabel}
      onChange={onLocalChange}
      onBlur={commitLocal}
      onKeyDown={onKeyDown}
    />
  );

  return (
    <span className={mergeClasses(styles.cell, jobLock.status === 'queued' ? styles.queued : undefined)}>
      {cellKeys ? (
        <CellHistoryPopover cellKeys={cellKeys} dataType={column.dataType} hasHistory={hasHistory}>
          {inputControl}
        </CellHistoryPopover>
      ) : (
        inputControl
      )}
    </span>
  );
}
