import React, { memo, useCallback } from 'react';
import { Text, makeStyles, tokens, shorthands } from '@fluentui/react-components';
import {
  Person24Regular,
  Table24Regular,
  CloudLink24Regular,
  Mail24Regular,
  Flowchart24Regular,
  History24Regular,
  ArrowClockwise24Regular,
  Link24Regular,
  Options24Regular,
} from '@fluentui/react-icons';
import SidebarNavItem from '../shared/SidebarNavItem';
import { getVisibleSettingsSections } from '../../utils/settingsAudience';

const ICONS = {
  general: Options24Regular,
  users: Person24Regular,
  analytics: Table24Regular,
  'mail-template': Mail24Regular,
  odata: CloudLink24Regular,
  datamodel: Flowchart24Regular,
  'external-links': Link24Regular,
  'track-changes': History24Regular,
  'd365-refresh': ArrowClockwise24Regular,
};

const useStyles = makeStyles({
  sidebar: {
    width: '220px',
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.borderRight('1px', 'solid', tokens.colorNeutralStroke1),
    paddingTop: tokens.spacingVerticalS,
    paddingBottom: tokens.spacingVerticalS,
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    overflowY: 'auto',
  },
  sectionHeading: {
    ...shorthands.margin(0),
    ...shorthands.padding('12px', '14px', '4px', '16px'),
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
});

function SettingsNavButton({ item, active, onSelect }) {
  const handleClick = useCallback(() => onSelect(item.id), [item.id, onSelect]);
  return (
    <SidebarNavItem
      icon={ICONS[item.id]}
      label={item.label}
      active={active}
      onClick={handleClick}
    />
  );
}

const MemoSettingsNavButton = memo(SettingsNavButton);

function AdminSettingsSidebar({ userRole, activeTab, onSelect }) {
  const styles = useStyles();
  const sections = getVisibleSettingsSections(userRole);

  return (
    <aside className={styles.sidebar}>
      {sections.map((section) => (
        <React.Fragment key={section.id}>
          <Text as="h2" className={styles.sectionHeading}>{section.heading}</Text>
          {section.items.map((item) => (
            <MemoSettingsNavButton
              key={item.id}
              item={item}
              active={activeTab === item.id}
              onSelect={onSelect}
            />
          ))}
        </React.Fragment>
      ))}
    </aside>
  );
}

export default memo(AdminSettingsSidebar);
