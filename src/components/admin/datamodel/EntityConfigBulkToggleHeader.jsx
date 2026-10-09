import React from 'react';
import { Button, TableHeaderCell, Tooltip, makeStyles, mergeClasses, shorthands, tokens } from '@fluentui/react-components';
import { CheckboxChecked20Regular, CheckboxUnchecked20Regular } from '@fluentui/react-icons';
import AdminInfoHint from './AdminInfoHint';

// Smalle, gecentreerde kolom per schakelaar: kort label (volledige naam als tooltip) en
// twee compacte knoppen voor alles aan/uit in plaats van tekstknoppen die de kop opblazen.
const useStyles = makeStyles({
  cell: {
    width: '104px',
    minWidth: '104px',
    textAlign: 'center',
  },
  // Fluent's kopknop lijnt links uit; deze wrapper vult de breedte zodat alles boven de
  // (gecentreerde) schakelaars uitkomt.
  headerBulkCell: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    flexGrow: 1,
    width: '100%',
    ...shorthands.gap('2px'),
  },
  // Het label zelf wordt gecentreerd; het info-icoon hangt ernaast en telt niet mee.
  headerLabel: {
    position: 'relative',
    whiteSpace: 'nowrap',
  },
  headerInfo: {
    position: 'absolute',
    left: '100%',
    top: '50%',
    transform: 'translateY(-50%)',
    marginLeft: '2px',
    display: 'inline-flex',
  },
  headerBulkButtons: { display: 'flex', ...shorthands.gap('2px') },
  headerBulkButton: { minWidth: 'auto', color: tokens.colorNeutralForeground3 },
});

export default function EntityConfigBulkToggleHeader({ label, fullLabel = label, info, action, className }) {
  const styles = useStyles();
  const count = action?.affectedCount ?? 0;
  const enableLabel = `Turn ${fullLabel} on for ${count} filtered columns`;
  const disableLabel = `Turn ${fullLabel} off for ${count} filtered columns`;
  return (
    <TableHeaderCell className={mergeClasses(className, styles.cell)}>
      <div className={styles.headerBulkCell}>
        <span className={styles.headerLabel} title={fullLabel}>
          {label}
          {info ? (
            <span className={styles.headerInfo}>
              <AdminInfoHint text={info} label={`About ${fullLabel}`} />
            </span>
          ) : null}
        </span>
        {action ? (
          <div className={styles.headerBulkButtons}>
            <Tooltip content={enableLabel} relationship="label">
              <Button
                size="small"
                appearance="subtle"
                className={styles.headerBulkButton}
                icon={<CheckboxChecked20Regular />}
                disabled={action.disableEnable}
                onClick={action.onEnable}
              />
            </Tooltip>
            <Tooltip content={disableLabel} relationship="label">
              <Button
                size="small"
                appearance="subtle"
                className={styles.headerBulkButton}
                icon={<CheckboxUnchecked20Regular />}
                disabled={action.disableDisable}
                onClick={action.onDisable}
              />
            </Tooltip>
          </div>
        ) : null}
      </div>
    </TableHeaderCell>
  );
}
