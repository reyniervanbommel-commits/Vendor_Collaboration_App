import React, { forwardRef } from 'react';
import { Button, makeStyles, mergeClasses, shorthands, tokens } from '@fluentui/react-components';
import { ChevronDownRegular, StarFilled } from '@fluentui/react-icons';
import { truncateViewName } from '../../utils/savedViewDisplay';
import UnsavedYellowDot from './UnsavedYellowDot';

const useStyles = makeStyles({
  titleTrigger: {
    maxWidth: '100%',
    minWidth: 0,
    width: 'max-content',
    height: 'auto',
    minHeight: 'unset',
    overflow: 'visible',
    lineHeight: '1.35',
    ...shorthands.padding('2px', '0', '4px'),
    ...shorthands.border('none'),
    justifyContent: 'flex-start',
    alignItems: 'center',
    ...shorthands.gap(tokens.spacingHorizontalS),
    color: tokens.colorNeutralForeground1,
    backgroundColor: 'transparent',
  },
  titleName: {
    maxWidth: '25ch',
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightRegular,
    lineHeight: '1.35',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'left',
  },
  titleMeta: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    ...shorthands.gap(tokens.spacingHorizontalXS),
  },
  titleStar: {
    fontSize: '14px',
    color: tokens.colorBrandForeground1,
  },
  titleChevron: {
    fontSize: '20px',
    flexShrink: 0,
  },
});

const PurchaseOrderSavedViewTitleTrigger = forwardRef(function PurchaseOrderSavedViewTitleTrigger({
  name,
  isDefault,
  hasUnsavedChanges,
  saving,
  ...triggerProps
}, ref) {
  const styles = useStyles();
  const displayName = truncateViewName(name);

  return (
    <Button
      {...triggerProps}
      ref={ref}
      appearance="subtle"
      className={mergeClasses(styles.titleTrigger, triggerProps.className)}
      disabled={saving || triggerProps.disabled}
      title={name}
      data-tour="po-view-title"
    >
      <span className={styles.titleName}>{displayName}</span>
      <span className={styles.titleMeta}>
        {isDefault ? <StarFilled className={styles.titleStar} aria-label="Default view" /> : null}
        {hasUnsavedChanges ? <UnsavedYellowDot testId="view-unsaved-dot" /> : null}
        <ChevronDownRegular className={styles.titleChevron} />
      </span>
    </Button>
  );
});

export default PurchaseOrderSavedViewTitleTrigger;
