import React from 'react';
import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import {
  Briefcase16Regular,
  Eye16Regular,
  People16Regular,
  Person16Regular,
} from '@fluentui/react-icons';

const useStyles = makeStyles({
  icon: {
    fontSize: '16px',
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  inherit: {
    color: 'inherit',
  },
});

// Native 16px glyphs: crisper than scaled-down 20px icons at menu size.
const SCOPE_ICONS = {
  personal: Person16Regular,
  global: People16Regular,
  vendor: Briefcase16Regular,
};

export default function SavedViewScopeIcon({ scope, hasId = true, inheritColor = false }) {
  const styles = useStyles();
  const Icon = hasId ? (SCOPE_ICONS[scope] || Person16Regular) : Eye16Regular;
  return <Icon className={mergeClasses(styles.icon, inheritColor && styles.inherit)} aria-hidden />;
}
