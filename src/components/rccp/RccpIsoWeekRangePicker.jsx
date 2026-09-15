import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  Button, Popover, PopoverSurface, PopoverTrigger, makeStyles, mergeClasses, shorthands, tokens,
} from '@fluentui/react-components';
import { CalendarWeekStart24Regular, ChevronLeftRegular, ChevronRightRegular } from '@fluentui/react-icons';
import {
  applyIsoWeekPickerClick,
  compareIsoWeekParts,
  currentIsoWindow,
  currentIsoWeekParts,
  formatIsoWindowLabel,
  isRccpDataWeeksActionDisabled,
  isoYearPickerYears,
  isoWeekPickerYearBounds,
  rccpIsoWeekPickerBounds,
  RCCP_WEEK_PICKER_DEFAULT_HEIGHT,
  clampWeekPickerListHeight,
} from './rccpUtils';
import RccpIsoWeekCalendarGrid from './RccpIsoWeekCalendarGrid';
import RccpIsoWeekYearPicker from './RccpIsoWeekYearPicker';

const useStyles = makeStyles({
  trigger: { minWidth: '220px', maxWidth: '280px' },
  triggerCompact: { minWidth: '168px', maxWidth: '220px' },
  surface: {
    ...shorthands.padding('8px'),
    width: 'max-content',
    boxSizing: 'border-box',
    overflow: 'visible',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '4px',
  },
  title: { fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase300 },
  hint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    marginBottom: '4px',
  },
  yearGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 52px)',
    ...shorthands.gap('4px'),
  },
  yearButton: { minWidth: '52px' },
  footer: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '6px',
    ...shorthands.gap('4px'),
  },
  presets: {
    display: 'flex',
    flexWrap: 'wrap',
    ...shorthands.gap('4px'),
  },
  footerActions: {
    display: 'flex',
    ...shorthands.gap('4px'),
  },
});

function RccpIsoWeekRangePicker({
  window: isoWindow, onReplaceWindow, analysis, onShowDataWindow, compact = false,
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(isoWindow.fromYear);
  const [yearAnchor, setYearAnchor] = useState(isoWindow.fromYear);
  const [pickingYear, setPickingYear] = useState(false);
  const [pending, setPending] = useState(null);
  const [locked, setLocked] = useState(null);
  const [cleared, setCleared] = useState(false);
  const [listHeight, setListHeight] = useState(RCCP_WEEK_PICKER_DEFAULT_HEIGHT);
  const [scrollYear, setScrollYear] = useState(null);
  const displayWindow = isoWindow;
  const label = cleared ? 'Select weeks' : formatIsoWindowLabel(isoWindow);
  const now = currentIsoWeekParts();
  const canShowDataWeeks = !isRccpDataWeeksActionDisabled(analysis);
  const yearSpan = useMemo(() => isoWeekPickerYearBounds({
    focusYear: isoWindow.fromYear,
    viewYear,
    nowYear: now.year,
    dataFromYear: analysis?.dataWindow?.fromYear,
    dataToYear: analysis?.dataWindow?.toYear,
  }), [isoWindow.fromYear, viewYear, now.year, analysis?.dataWindow?.fromYear, analysis?.dataWindow?.toYear]);
  const years = useMemo(() => isoYearPickerYears(yearAnchor), [yearAnchor]);
  const { from, to } = useMemo(
    () => rccpIsoWeekPickerBounds(displayWindow, cleared),
    [cleared, displayWindow.fromYear, displayWindow.fromWeek, displayWindow.toYear, displayWindow.toWeek],
  );
  const focusWeek = useMemo(
    () => ({ year: isoWindow.fromYear, week: isoWindow.fromWeek }),
    [isoWindow.fromYear, isoWindow.fromWeek],
  );

  const showYear = useCallback((year) => {
    setViewYear(year);
    setYearAnchor(year);
    setPickingYear(false);
  }, []);

  const handleOpenChange = useCallback((_, data) => {
    const nextOpen = Boolean(data.open);
    setOpen(nextOpen);
    if (nextOpen) {
      setPending(null);
      setScrollYear(null);
      showYear(isoWindow.fromYear);
    }
  }, [isoWindow.fromYear, showYear]);

  const goPrev = useCallback(() => {
    if (pickingYear) {
      setYearAnchor((year) => year - 12);
      return;
    }
    const next = viewYear - 1;
    setViewYear(next);
    setScrollYear(next);
  }, [pickingYear, viewYear]);

  const goNext = useCallback(() => {
    if (pickingYear) {
      setYearAnchor((year) => year + 12);
      return;
    }
    const next = viewYear + 1;
    setViewYear(next);
    setScrollYear(next);
  }, [pickingYear, viewYear]);

  const openYearPicker = useCallback(() => {
    setYearAnchor(viewYear);
    setPickingYear(true);
  }, [viewYear]);

  const handleListHeight = useCallback((next) => {
    setListHeight(clampWeekPickerListHeight(next));
  }, []);

  const handleSelectYear = useCallback((year) => {
    showYear(year);
    setScrollYear(year);
  }, [showYear]);

  const handleSelectWeek = useCallback((parts) => {
    const result = applyIsoWeekPickerClick({
      pending, locked, window: cleared ? null : displayWindow,
    }, parts);
    setPending(result.pending);
    setLocked(result.locked);
    if (result.apply && result.window) {
      setCleared(false);
      onReplaceWindow(result.window);
    }
  }, [pending, locked, cleared, displayWindow, onReplaceWindow]);

  const handleNow = useCallback(() => {
    const nextTo = currentIsoWeekParts();
    const pinned = locked || from;
    const nextFrom = pinned && compareIsoWeekParts(pinned, nextTo) <= 0 ? pinned : nextTo;
    setCleared(false);
    onReplaceWindow({
      fromYear: nextFrom.year,
      fromWeek: nextFrom.week,
      toYear: nextTo.year,
      toWeek: nextTo.week,
    });
    setPending(null);
    showYear(nextTo.year);
    setScrollYear(nextTo.year);
  }, [from, locked, onReplaceWindow, showYear]);

  const handleShowDataWeeks = useCallback(() => {
    setCleared(false);
    onShowDataWindow?.();
    setPending(null);
    setLocked(null);
  }, [onShowDataWindow]);

  const handleClearAll = useCallback(() => {
    const next = currentIsoWindow(8);
    setCleared(true);
    onReplaceWindow(next);
    setPending(null);
    setLocked(null);
    setScrollYear(null);
    showYear(next.fromYear);
  }, [onReplaceWindow, showYear]);

  const title = pickingYear ? `${years[0]} – ${years[years.length - 1]}` : String(viewYear);
  const prevLabel = pickingYear ? 'Previous years' : 'Previous year';
  const nextLabel = pickingYear ? 'Next years' : 'Next year';

  return (
    <Popover open={open} onOpenChange={handleOpenChange} positioning="below-start" trapFocus withArrow>
      <PopoverTrigger disableButtonEnhancement>
        <Button
          className={mergeClasses(styles.trigger, compact && styles.triggerCompact)}
          size={compact ? 'small' : 'medium'}
          appearance="outline"
          icon={<CalendarWeekStart24Regular />}
          aria-label={`Period ${label}`}
          data-tour="rccp-week-picker"
        >
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverSurface className={styles.surface} aria-label="Week period picker">
        <div className={styles.header}>
          <Button appearance="subtle" size="small" icon={<ChevronLeftRegular />} aria-label={prevLabel} onClick={goPrev} />
          {pickingYear ? (
            <span className={styles.title}>{title}</span>
          ) : (
            <Button appearance="transparent" className={styles.title} aria-label={`Choose year ${viewYear}`} onClick={openYearPicker}>
              {title}
            </Button>
          )}
          <Button appearance="subtle" size="small" icon={<ChevronRightRegular />} aria-label={nextLabel} onClick={goNext} />
        </div>
        <div className={styles.hint}>
          {pickingYear ? 'Select a year.' : 'Click a week twice to lock it, then pick the other end.'}
        </div>
        {pickingYear ? (
          <RccpIsoWeekYearPicker
            years={years}
            viewYear={viewYear}
            onSelectYear={handleSelectYear}
            gridClassName={styles.yearGrid}
            buttonClassName={styles.yearButton}
          />
        ) : (
          <RccpIsoWeekCalendarGrid
            yearSpan={yearSpan}
            from={from}
            to={to}
            now={now}
            locked={locked}
            onSelectWeek={handleSelectWeek}
            listHeight={listHeight}
            onListHeightChange={handleListHeight}
            focusWeek={focusWeek}
            scrollYear={scrollYear}
          />
        )}
        <div className={styles.footer}>
          <div className={styles.presets}>
            <Button
              size="small"
              disabled={!canShowDataWeeks}
              title={canShowDataWeeks ? undefined : 'No weeks with data for this vendor'}
              onClick={handleShowDataWeeks}
              data-tour="rccp-show-data-weeks"
            >
              Show weeks with data
            </Button>
          </div>
          <div className={styles.footerActions}>
            <Button appearance="transparent" size="small" onClick={handleClearAll}>Clear all</Button>
            <Button appearance="transparent" size="small" onClick={handleNow}>Now</Button>
          </div>
        </div>
      </PopoverSurface>
    </Popover>
  );
}

export default memo(RccpIsoWeekRangePicker);
