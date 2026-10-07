import React from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import { BuildingRegular, EyeRegular, PeopleRegular, PersonRegular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  icon: {
    fontSize: '16px',
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
});

const SCOPE_ICONS = {
  personal: PersonRegular,
  global: PeopleRegular,
  vendor: BuildingRegular,
};

export default function SavedViewScopeIcon({ scope, hasId = true }) {
  const styles = useStyles();
  const Icon = hasId ? (SCOPE_ICONS[scope] || PersonRegular) : EyeRegular;
  return <Icon className={styles.icon} aria-hidden />;
}
