import React, { forwardRef } from 'react';
import { Button, makeStyles, mergeClasses, shorthands, tokens } from '@fluentui/react-components';
import { ChevronDownRegular } from '@fluentui/react-icons';
import { VIEW_NAME_MAX_LENGTH } from '../../utils/savedViewDisplay';
import UnsavedYellowDot from './UnsavedYellowDot';

/** Room after the name for the unsaved dot + chevron (always reserved, so tabs never shift). */
export const VIEW_TITLE_META_WIDTH = '44px';

/**
 * Minimum width of the title slot: 25 characters of the title font plus the dot/chevron.
 * `ch` resolves against the element's own font-size, so the slot must use the title font.
 * Names up to 25 chars (the save-dialog limit) keep the tabs at a fixed x; older, longer
 * names widen the slot instead of being cut off.
 */
export const VIEW_TITLE_SLOT_WIDTH = `calc(${VIEW_NAME_MAX_LENGTH}ch + ${VIEW_TITLE_META_WIDTH})`;

const useStyles = makeStyles({
  titleTrigger: {
    width: 'max-content',
    maxWidth: '100%',
    minWidth: 0,
    height: 'auto',
    minHeight: 'unset',
    ...shorthands.padding('2px', '0', '4px'),
    ...shorthands.border('none'),
    justifyContent: 'flex-start',
    alignItems: 'center',
    color: tokens.colorNeutralForeground1,
    backgroundColor: 'transparent',
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightRegular,
    lineHeight: '1.35',
  },
  titleCluster: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
    ...shorthands.gap(tokens.spacingHorizontalXS),
  },
  // Full name; ellipsis only as a last resort when the page itself is too narrow.
  titleName: {
    minWidth: 0,
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
    color: tokens.colorNeutralForeground2,
  },
});

const PurchaseOrderSavedViewTitleTrigger = forwardRef(function PurchaseOrderSavedViewTitleTrigger({
  name,
  hasUnsavedChanges,
  saving,
  ...triggerProps
}, ref) {
  const styles = useStyles();

  return (
    <Button
      {...triggerProps}
      ref={ref}
      appearance="subtle"
      className={mergeClasses(styles.titleTrigger, triggerProps.className)}
      disabled={saving || triggerProps.disabled}
      title={hasUnsavedChanges ? `${name} (unsaved changes)` : name}
      data-tour="po-view-title"
    >
      <span className={styles.titleCluster}>
        <span className={styles.titleName}>{name}</span>
        <span className={styles.titleMeta}>
          {hasUnsavedChanges ? <UnsavedYellowDot testId="view-unsaved-dot" /> : null}
          <ChevronDownRegular className={styles.titleChevron} />
        </span>
      </span>
    </Button>
  );
});

export default PurchaseOrderSavedViewTitleTrigger;
