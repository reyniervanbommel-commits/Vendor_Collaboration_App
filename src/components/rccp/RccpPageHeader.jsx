import React, { memo } from 'react';
import { Tab, TabList, Text, makeStyles, tokens, shorthands } from '@fluentui/react-components';

const useStyles = makeStyles({
  row: {
    display: 'flex',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    ...shorthands.gap(tokens.spacingHorizontalL),
  },
});

function RccpPageHeader({ activeTab, onTabSelect }) {
  const styles = useStyles();
  return (
    <div className={styles.row}>
      <Text size={700} weight="semibold">Performance & Planning</Text>
      <TabList size="small" selectedValue={activeTab} onTabSelect={onTabSelect}>
        <Tab value="dashboard">Dashboard</Tab>
        <Tab value="capacity-planning">Capacity planning</Tab>
      </TabList>
    </div>
  );
}

export default memo(RccpPageHeader);
