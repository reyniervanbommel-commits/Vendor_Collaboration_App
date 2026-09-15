import React, { memo } from 'react';
import { Link } from 'react-router-dom';
import {
  Button, Divider, Text, makeStyles, shorthands, tokens,
} from '@fluentui/react-components';
import { ArrowRightRegular } from '@fluentui/react-icons';
import RccpIsoWeekRangePicker from './RccpIsoWeekRangePicker';
import RccpLoadDateToggle from './RccpLoadDateToggle';
import RccpPeriodGrainToggle from './RccpPeriodGrainToggle';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap(tokens.spacingHorizontalXS),
    flexWrap: 'wrap',
    flex: 1,
    minWidth: 0,
  },
  divider: {
    height: '20px',
  },
  cluster: {
    display: 'inline-flex',
    alignItems: 'center',
    ...shorthands.gap(tokens.spacingHorizontalS),
    marginLeft: 'auto',
    flexWrap: 'wrap',
    minWidth: 0,
  },
  vendor: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: 'nowrap',
  },
});

function RccpSplitToolbar({
  isoWindow,
  onReplaceWindow,
  periodGrain,
  onPeriodGrainChange,
  planningDateModes,
  onPlanningDateModesChange,
  vendorAccount,
  analysis,
  onShowDataWindow,
}) {
  const styles = useStyles();
  const vendorLabel = vendorAccount ? `Vendor: ${vendorAccount}` : 'All vendors';

  return (
    <div className={styles.root} role="group" aria-label="RCCP controls">
      <Divider vertical className={styles.divider} />
      <div className={styles.cluster}>
        <Text className={styles.vendor}>{vendorLabel}</Text>
        <RccpIsoWeekRangePicker
          window={isoWindow}
          onReplaceWindow={onReplaceWindow}
          analysis={analysis}
          onShowDataWindow={onShowDataWindow}
          compact
        />
        <RccpPeriodGrainToggle value={periodGrain} onChange={onPeriodGrainChange} />
        <RccpLoadDateToggle
          value={planningDateModes}
          onChange={onPlanningDateModesChange}
          confirmedPercent={analysis?.kpis?.confirmedPercent}
        />
        <Button
          as={Link}
          to="/rccp"
          size="small"
          appearance="subtle"
          icon={<ArrowRightRegular />}
          iconPosition="after"
        >
          Open PERF page
        </Button>
      </div>
    </div>
  );
}

export default memo(RccpSplitToolbar);
