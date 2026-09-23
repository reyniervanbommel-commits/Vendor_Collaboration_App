import React, { memo, useCallback } from 'react';
import { Checkbox, Text, makeStyles, tokens, shorthands } from '@fluentui/react-components';
import { PAGE_PERMISSIONS_BY_ID } from '../../constants/pagePermissions';
import { getGrantableSettingsSections } from '../../utils/settingsAudience';

const SECTIONS = getGrantableSettingsSections();

const useStyles = makeStyles({
  list: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('12px'),
    marginTop: '8px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('4px'),
  },
  heading: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  description: {
    display: 'block',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    marginLeft: '28px',
    marginTop: '-4px',
  },
});

function PermissionRow({ id, label, description, checked, onToggle }) {
  const styles = useStyles();
  const handleChange = useCallback(() => onToggle(id), [id, onToggle]);
  return (
    <div>
      <Checkbox label={label} checked={checked} onChange={handleChange} />
      {description && <Text className={styles.description}>{description}</Text>}
    </div>
  );
}

const MemoPermissionRow = memo(PermissionRow);

/**
 * Toewijsbare instellingen-permissies, gegroepeerd per sidebar-sectie (#AB:326).
 * @param {{ selected: string[], onToggle: (id: string) => void }} props
 */
function PermissionsChecklist({ selected, onToggle }) {
  const styles = useStyles();
  return (
    <div className={styles.list}>
      {SECTIONS.map((section) => (
        <div key={section.id} className={styles.section}>
          <Text className={styles.heading}>{section.heading}</Text>
          {section.items.map((item) => (
            <MemoPermissionRow
              key={item.id}
              id={item.id}
              label={item.label}
              description={PAGE_PERMISSIONS_BY_ID[item.id]?.description}
              checked={selected.includes(item.id)}
              onToggle={onToggle}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default memo(PermissionsChecklist);
