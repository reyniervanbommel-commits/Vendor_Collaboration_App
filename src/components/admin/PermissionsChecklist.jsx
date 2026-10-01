import React, { memo, useCallback } from 'react';
import { Checkbox, Text, makeStyles, tokens, shorthands } from '@fluentui/react-components';
import { PAGE_PERMISSIONS_BY_ID } from '../../constants/pagePermissions';
import { COMMENT_PERMISSIONS } from '../../constants/commentPermissions';
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
 * Instellingen-permissies plus comment-rechten (#AB:326, #AB:328).
 * @param {{ selected: string[], onToggle: (id: string) => void, includeSettings?: boolean }} props
 */
function PermissionsChecklist({ selected, onToggle, includeSettings = true }) {
  const styles = useStyles();
  return (
    <div className={styles.list}>
      {includeSettings && SECTIONS.map((section) => (
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
      <div className={styles.section}>
        <Text className={styles.heading}>Comments</Text>
        {COMMENT_PERMISSIONS.map((item) => (
          <MemoPermissionRow
            key={item.id}
            id={item.id}
            label={item.label}
            checked={selected.includes(item.id)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

export default memo(PermissionsChecklist);
