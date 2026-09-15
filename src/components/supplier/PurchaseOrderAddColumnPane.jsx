import React, { memo, useCallback, useMemo } from 'react';
import { Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import { NEW_COLUMN_TYPES } from './purchaseOrderColumnFilterMenuConstants';
import { renderColumnTypeIcon } from './purchaseOrderColumnFilterMenuMainPaneUtils';

const useStyles = makeStyles({
  subPaneTitle: {
    fontWeight: tokens.fontWeightRegular,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    marginBottom: '4px',
  },
  typeButton: {
    justifyContent: 'flex-start',
  },
  typeButtonContent: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
  },
});

const AddColumnTypeButton = memo(function AddColumnTypeButton({ type, styles, disabled, onConfirm }) {
  const localStyles = useStyles();
  const handleClick = useCallback(() => onConfirm(type), [onConfirm, type]);
  return (
    <Button
      className={localStyles.typeButton}
      appearance="subtle"
      size="small"
      disabled={disabled}
      onClick={handleClick}
      data-tour={`col-type-${type.key}`}
    >
      <span className={localStyles.typeButtonContent}>
        <span className={styles.menuItemIcon} aria-hidden>
          {renderColumnTypeIcon(type.key)}
        </span>
        <span>{disabled ? `${type.label} · Already added` : type.label}</span>
      </span>
    </Button>
  );
});

export default function PurchaseOrderAddColumnPane({
  styles,
  columnLevel = 'header',
  remarksAlreadyAdded = false,
  onConfirm,
}) {
  const localStyles = useStyles();
  const addableTypes = useMemo(
    () => (columnLevel === 'header'
      ? NEW_COLUMN_TYPES
      : NEW_COLUMN_TYPES.filter((type) => !['image', 'remarks', 'date_wm'].includes(type.key))),
    [columnLevel]
  );

  return (
    <>
      <Text className={localStyles.subPaneTitle}>Column type</Text>
      {addableTypes.map((type) => (
        <AddColumnTypeButton
          key={type.key}
          type={type}
          styles={styles}
          disabled={type.dataType === 'remarks' && remarksAlreadyAdded}
          onConfirm={onConfirm}
        />
      ))}
    </>
  );
}
