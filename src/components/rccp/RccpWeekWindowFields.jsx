import React, { memo, useCallback } from 'react';
import { Field, Switch, makeStyles, shorthands, tokens } from '@fluentui/react-components';
import RccpIsoWeekRangePicker from './RccpIsoWeekRangePicker';
import RccpLoadDateToggle from './RccpLoadDateToggle';
import RccpPeriodGrainToggle from './RccpPeriodGrainToggle';

const useStyles = makeStyles({
  switchField: { alignSelf: 'flex-end' },
  viewField: { minWidth: '160px', maxWidth: '320px' },
  periodField: { minWidth: '220px', maxWidth: '280px' },
  toggles: {
    display: 'flex',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    ...shorthands.gap(tokens.spacingHorizontalM),
    marginLeft: 'auto',
  },
});

/**
 * ISO-week range picker, chart/matrix week-or-month view, and KPI window switch.
 */
function RccpWeekWindowFields({
  window, onWindowReplace, kpiWindowOnly, onKpiWindowOnlyChange, periodGrain, onPeriodGrainChange,
  analysis, onShowDataWindow, planningDateModes, onPlanningDateModesChange,
}) {
  const styles = useStyles();
  const handleToggle = useCallback((_, data) => {
    onKpiWindowOnlyChange(Boolean(data.checked));
  }, [onKpiWindowOnlyChange]);

  return (
    <>
      <Field className={styles.periodField} label="Period">
        <RccpIsoWeekRangePicker
          window={window}
          onReplaceWindow={onWindowReplace}
          analysis={analysis}
          onShowDataWindow={onShowDataWindow}
        />
      </Field>
      <Switch
        className={styles.switchField}
        root={{ 'data-tour': 'rccp-kpi-window-switch' }}
        label="KPIs in selected weeks"
        checked={kpiWindowOnly}
        onChange={handleToggle}
      />
      <div className={styles.toggles} role="group" aria-label="Week and load date" data-tour="rccp-view-toggles">
        <Field className={styles.viewField} label="View">
          <RccpPeriodGrainToggle value={periodGrain} onChange={onPeriodGrainChange} />
        </Field>
        <Field className={styles.viewField} label="Load date">
          <RccpLoadDateToggle
            value={planningDateModes}
            onChange={onPlanningDateModesChange}
            confirmedPercent={analysis?.kpis?.confirmedPercent}
          />
        </Field>
      </div>
    </>
  );
}

export default memo(RccpWeekWindowFields);
