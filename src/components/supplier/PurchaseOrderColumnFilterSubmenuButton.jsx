import React, { memo, useCallback } from 'react';
import { Button } from '@fluentui/react-components';
import { submenuLabel } from './purchaseOrderColumnFilterMenuMainPaneUtils';

function PurchaseOrderColumnFilterSubmenuButton({
  styles,
  name,
  label,
  icon,
  activeSubmenu,
  onOpenSubmenu,
}) {
  const handleOpen = useCallback((event) => {
    onOpenSubmenu(name, event);
  }, [name, onOpenSubmenu]);

  return (
    <Button
      className={`${styles.sortButton} ${styles.submenuButton} ${activeSubmenu === name ? styles.submenuButtonActive : ''}`}
      appearance="subtle"
      size="small"
      onMouseEnter={handleOpen}
      onFocus={handleOpen}
      onClick={handleOpen}
      data-tour={`col-submenu-${name}`}
    >
      {submenuLabel(styles, icon, label)}
    </Button>
  );
}

export default memo(PurchaseOrderColumnFilterSubmenuButton);
