import React, { memo, useCallback } from 'react';
import { RadioGroup, Radio, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { RCCP_PLANNING_DATE_CONFIRMED, RCCP_PLANNING_DATE_REQUESTED } from './rccpPeriodGrain';
import { useRccpToggleFrameStyles } from './rccpToggleFrameStyles';

const useStyles = makeStyles({
  group: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalXS,
    '& .fui-Radio__indicator': {
      marginTop: 0,
      marginBottom: 0,
      marginLeft: tokens.spacingHorizontalXXS,
      marginRight: tokens.spacingHorizontalXXS,
    },
    '& .fui-Radio__label': {
      paddingTop: 0,
      paddingBottom: 0,
      paddingLeft: tokens.spacingHorizontalXXS,
      paddingRight: tokens.spacingHorizontalXS,
      fontSize: tokens.fontSizeBase200,
      lineHeight: tokens.lineHeightBase200,
    },
  },
});

/**
 * Centrale requested/confirmed-schakelaar voor een KPI-tegel-strip (bv. de "KPIs"-tab van het
 * PO-board). Anders dan `RccpLoadDateToggle` (dat 2 onafhankelijke aan/uit-toggles heeft voor
 * de grafiek) is dit een enkelvoudige keuze: de tegels tonen precies 1 datumbasis.
 * @param {{ value: 'requested'|'confirmed', onChange: (value: string) => void }} props
 */
function KpiDateModeToggle({ value, onChange }) {
  const frameStyles = useRccpToggleFrameStyles();
  const styles = useStyles();
  const handleChange = useCallback((_, data) => {
    onChange?.(data.value);
  }, [onChange]);

  return (
    <div className={frameStyles.frame} data-tour="kpi-date-mode-toggle">
      <RadioGroup
        className={mergeClasses(frameStyles.group, styles.group)}
        layout="horizontal"
        value={value === RCCP_PLANNING_DATE_CONFIRMED ? RCCP_PLANNING_DATE_CONFIRMED : RCCP_PLANNING_DATE_REQUESTED}
        onChange={handleChange}
        aria-label="KPI date basis"
      >
        <Radio value={RCCP_PLANNING_DATE_REQUESTED} label="Req." />
        <Radio value={RCCP_PLANNING_DATE_CONFIRMED} label="Conf." />
      </RadioGroup>
    </div>
  );
}

export default memo(KpiDateModeToggle);
