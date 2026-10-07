import React, { forwardRef } from 'react';
import { Button, makeStyles, mergeClasses, shorthands, tokens } from '@fluentui/react-components';
import { ChevronDownRegular } from '@fluentui/react-icons';
import { truncateViewName } from '../../utils/savedViewDisplay';
import UnsavedYellowDot from './UnsavedYellowDot';

const useStyles = makeStyles({
  titleTrigger: {
    maxWidth: '100%',
    minWidth: '25ch',
    width: '25ch',
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
  titleCluster: {
    display: 'flex',
    alignItems: 'center',
    width: 'max-content',
    maxWidth: 'none',
    flexShrink: 0,
    ...shorthands.gap(tokens.spacingHorizontalS),
  },
  titleName: {
    minWidth: 0,
    maxWidth: '25ch',
    width: 'max-content',
    flexGrow: 0,
    flexShrink: 0,
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
  titleChevron: {
    fontSize: '20px',
    flexShrink: 0,
  },
});

const PurchaseOrderSavedViewTitleTrigger = forwardRef(function PurchaseOrderSavedViewTitleTrigger({
  name,
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
      <span className={styles.titleCluster}>
        <span className={styles.titleName}>{displayName}</span>
        <span className={styles.titleMeta}>
          {hasUnsavedChanges ? <UnsavedYellowDot testId="view-unsaved-dot" /> : null}
          <ChevronDownRegular className={styles.titleChevron} />
        </span>
      </span>
    </Button>
  );
});

export default PurchaseOrderSavedViewTitleTrigger;
